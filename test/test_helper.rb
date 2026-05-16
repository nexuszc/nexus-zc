require 'minitest/autorun'
require 'logger'
require 'net/http'
require 'uri'
require 'json'

module TestHelper
  class << self
    def logger
      @logger ||= begin
        log_level = ENV['CI'] ? Logger::INFO : Logger::DEBUG
        logger = Logger.new($stdout)
        logger.level = log_level
        logger.formatter = proc do |severity, datetime, progname, msg|
          timestamp = datetime.strftime('%Y-%m-%d %H:%M:%S.%L')
          "[#{timestamp}] #{severity}: #{msg}\n"
        end
        logger
      end
    end

    def retry_with_backoff(max_attempts: 5, initial_delay: 1, max_delay: 30, &block)
      attempt = 0
      delay = initial_delay

      loop do
        attempt += 1
        
        begin
          logger.debug("Attempt #{attempt}/#{max_attempts}")
          result = yield
          logger.debug("Success on attempt #{attempt}")
          return result
        rescue StandardError => e
          if attempt >= max_attempts
            logger.error("Failed after #{max_attempts} attempts: #{e.class} - #{e.message}")
            logger.error(e.backtrace.join("\n")) if ENV['DEBUG']
            raise
          end

          logger.warn("Attempt #{attempt} failed: #{e.class} - #{e.message}")
          logger.debug("Retrying in #{delay}s...")
          sleep(delay)
          
          delay = [delay * 2, max_delay].min
        end
      end
    end

    def validate_environment
      required_vars = ['DATABASE_URL', 'REDIS_URL']
      missing_vars = required_vars.select { |var| ENV[var].nil? || ENV[var].empty? }

      unless missing_vars.empty?
        logger.error("Missing required environment variables: #{missing_vars.join(', ')}")
        return false
      end

      logger.info("Environment validation passed")
      true
    end

    def check_database_connection
      require 'pg'
      
      retry_with_backoff(max_attempts: 3, initial_delay: 2) do
        uri = URI.parse(ENV['DATABASE_URL'])
        conn = PG.connect(
          host: uri.host,
          port: uri.port || 5432,
          dbname: uri.path[1..-1],
          user: uri.user,
          password: uri.password,
          connect_timeout: 5
        )
        
        result = conn.exec('SELECT 1 as health_check')
        success = result.ntuples == 1 && result[0]['health_check'] == '1'
        conn.close
        
        if success
          logger.info("Database connection healthy")
        else
          raise "Database health check failed"
        end
        
        success
      end
    rescue PG::Error => e
      logger.error("Database connection failed: #{e.message}")
      false
    end

    def check_redis_connection
      require 'redis'
      
      retry_with_backoff(max_attempts: 3, initial_delay: 2) do
        uri = URI.parse(ENV['REDIS_URL'])
        redis = Redis.new(
          host: uri.host,
          port: uri.port || 6379,
          password: uri.password,
          timeout: 5,
          reconnect_attempts: 1
        )
        
        result = redis.ping
        redis.close
        
        if result == 'PONG'
          logger.info("Redis connection healthy")
        else
          raise "Redis health check failed"
        end
        
        true
      end
    rescue Redis::BaseError => e
      logger.error("Redis connection failed: #{e.message}")
      false
    end

    def http_client(timeout: 10, open_timeout: 5)
      Net::HTTP.class_eval do
        alias_method :original_request, :request unless method_defined?(:original_request)
        
        def request(req, body = nil, &block)
          start_time = Time.now
          TestHelper.logger.debug("HTTP #{req.method} #{req.path}")
          
          response = original_request(req, body, &block)
          
          duration = ((Time.now - start_time) * 1000).round(2)
          TestHelper.logger.debug("HTTP #{response.code} in #{duration}ms")
          
          response
        end
      end

      http = Net::HTTP.new(nil)
      http.read_timeout = timeout
      http.open_timeout = open_timeout
      http
    end

    def http_get(url, headers: {}, timeout: 10)
      uri = URI.parse(url)
      
      retry_with_backoff(max_attempts: 3, initial_delay: 1) do
        Net::HTTP.start(uri.host, uri.port, 
                       use_ssl: uri.scheme == 'https',
                       read_timeout: timeout,
                       open_timeout: 5) do |http|
          request = Net::HTTP::Get.new(uri.request_uri)
          headers.each { |key, value| request[key] = value }
          
          logger.debug("GET #{url}")
          response = http.request(request)
          logger.debug("Response: #{response.code}")
          
          response
        end
      end
    rescue StandardError => e
      logger.error("HTTP GET failed for #{url}: #{e.message}")
      raise
    end

    def http_post(url, body:, headers: {}, timeout: 10)
      uri = URI.parse(url)
      
      retry_with_backoff(max_attempts: 3, initial_delay: 1) do
        Net::HTTP.start(uri.host, uri.port,
                       use_ssl: uri.scheme == 'https',
                       read_timeout: timeout,
                       open_timeout: 5) do |http|
          request = Net::HTTP::Post.new(uri.request_uri)
          request['Content-Type'] = 'application/json' unless headers['Content-Type']
          headers.each { |key, value| request[key] = value }
          request.body = body.is_a?(String) ? body : JSON.generate(body)
          
          logger.debug("POST #{url}")
          response = http.request(request)
          logger.debug("Response: #{response.code}")
          
          response
        end
      end
    rescue StandardError => e
      logger.error("HTTP POST failed for #{url}: #{e.message}")
      raise
    end

    def wait_for_condition(timeout: 30, interval: 1, description: "condition")
      start_time = Time.now
      
      loop do
        elapsed = Time.now - start_time
        
        if elapsed > timeout
          logger.error("Timeout waiting for #{description} (#{timeout}s)")
          raise "Timeout waiting for #{description}"
        end
        
        begin
          result = yield
          if result
            logger.info("Condition met: #{description} (#{elapsed.round(2)}s)")
            return true
          end
        rescue StandardError => e
          logger.debug("Condition check failed: #{e.message}")
        end
        
        sleep(interval)
      end
    end

    def cleanup_test_data
      logger.info("Starting test data cleanup")
      
      begin
        require 'pg'
        uri = URI.parse(ENV['DATABASE_URL'])
        conn = PG.connect(
          host: uri.host,
          port: uri.port || 5432,
          dbname: uri.path[1..-1],
          user: uri.user,
          password: uri.password
        )
        
        conn.exec("DELETE FROM test_records WHERE created_at < NOW() - INTERVAL '1 hour'")
        conn.close
        logger.info("Test data cleanup completed")
      rescue StandardError => e
        logger.warn("Test data cleanup failed: #{e.message}")
      end