require 'bundler/setup'
require 'minitest/autorun'
require 'httparty'
require 'json'
require 'logger'

class SmokeTest < Minitest::Test
  MAX_RETRIES = 3
  RETRY_DELAY = 2
  ASYNC_TIMEOUT = 10

  def setup
    @logger = Logger.new(STDOUT)
    @logger.level = Logger::DEBUG
    @logger.formatter = proc do |severity, datetime, progname, msg|
      "[#{datetime.strftime('%Y-%m-%d %H:%M:%S.%L')}] #{severity}: #{msg}\n"
    end
    
    @logger.info "=== Starting Smoke Test ==="
    @start_time = Time.now
    @errors = []
  end

  def teardown
    duration = Time.now - @start_time
    @logger.info "=== Smoke Test Complete (#{duration.round(2)}s) ==="
    
    if @errors.any?
      @logger.error "=== ERRORS ENCOUNTERED ==="
      @errors.each_with_index do |error, index|
        @logger.error "Error #{index + 1}: #{error}"
      end
    end
  end

  def test_environment_variables
    @logger.info "Checking environment variables..."
    
    required_vars = ['SUPABASE_URL', 'SUPABASE_KEY']
    missing_vars = []
    
    required_vars.each do |var|
      value = ENV[var]
      if value.nil? || value.empty?
        missing_vars << var
        @logger.error "Missing environment variable: #{var}"
      else
        masked_value = var.include?('KEY') ? "#{value[0..10]}..." : value
        @logger.info "#{var}: #{masked_value}"
      end
    end
    
    assert_empty missing_vars, "Missing required environment variables: #{missing_vars.join(', ')}"
  end

  def test_database_connectivity
    @logger.info "Testing database connectivity..."
    
    url = "#{ENV['SUPABASE_URL']}/rest/v1/"
    headers = {
      'apikey' => ENV['SUPABASE_KEY'],
      'Authorization' => "Bearer #{ENV['SUPABASE_KEY']}"
    }
    
    begin
      response = HTTParty.get(url, headers: headers, timeout: 5)
      @logger.info "Database connectivity check - Status: #{response.code}"
      
      assert [200, 404].include?(response.code), "Database unreachable. Status: #{response.code}"
    rescue => e
      error_msg = "Database connectivity failed: #{e.class} - #{e.message}"
      @logger.error error_msg
      @errors << error_msg
      raise
    end
  end

  def test_health_monitor_function
    @logger.info "Testing health-monitor edge function..."
    
    url = "#{ENV['SUPABASE_URL']}/functions/v1/health-monitor"
    headers = {
      'Authorization' => "Bearer #{ENV['SUPABASE_KEY']}",
      'Content-Type' => 'application/json'
    }
    
    retry_with_backoff do
      response = HTTParty.post(url, headers: headers, body: {}.to_json, timeout: 10)
      @logger.info "health-monitor response - Status: #{response.code}, Body: #{response.body[0..200]}"
      
      if response.code == 200
        body = JSON.parse(response.body) rescue {}
        @logger.info "health-monitor parsed response: #{body}"
      end
      
      assert_includes [200, 201], response.code, "health-monitor failed with status #{response.code}: #{response.body}"
    end
  end

  def test_system_heartbeat_function
    @logger.info "Testing system-heartbeat edge function..."
    
    url = "#{ENV['SUPABASE_URL']}/functions/v1/system-heartbeat"
    headers = {
      'Authorization' => "Bearer #{ENV['SUPABASE_KEY']}",
      'Content-Type' => 'application/json'
    }
    
    retry_with_backoff do
      response = HTTParty.post(url, headers: headers, body: {}.to_json, timeout: 10)
      @logger.info "system-heartbeat response - Status: #{response.code}, Body: #{response.body[0..200]}"
      
      if response.code == 200
        body = JSON.parse(response.body) rescue {}
        @logger.info "system-heartbeat parsed response: #{body}"
      end
      
      assert_includes [200, 201], response.code, "system-heartbeat failed with status #{response.code}: #{response.body}"
    end
  end

  def test_auth_endpoint
    @logger.info "Testing auth endpoint..."
    
    url = "#{ENV['SUPABASE_URL']}/auth/v1/health"
    headers = {
      'apikey' => ENV['SUPABASE_KEY']
    }
    
    begin
      response = HTTParty.get(url, headers: headers, timeout: 5)
      @logger.info "Auth health check - Status: #{response.code}, Body: #{response.body}"
      
      assert_includes [200, 201], response.code, "Auth endpoint failed with status #{response.code}"
    rescue => e
      error_msg = "Auth endpoint test failed: #{e.class} - #{e.message}"
      @logger.error error_msg
      @errors << error_msg
      raise
    end
  end

  def test_async_operations
    @logger.info "Testing async operations with retry logic..."
    
    url = "#{ENV['SUPABASE_URL']}/rest/v1/rpc/version"
    headers = {
      'apikey' => ENV['SUPABASE_KEY'],
      'Authorization' => "Bearer #{ENV['SUPABASE_KEY']}",
      'Content-Type' => 'application/json'
    }
    
    retry_with_backoff do
      response = HTTParty.post(url, headers: headers, body: {}.to_json, timeout: ASYNC_TIMEOUT)
      @logger.info "Async operation response - Status: #{response.code}"
      
      assert [200, 404].include?(response.code), "Async operation failed with unexpected status #{response.code}"
    end
  end

  private

  def retry_with_backoff(max_retries: MAX_RETRIES, delay: RETRY_DELAY)
    attempt = 0
    begin
      attempt += 1
      @logger.debug "Attempt #{attempt}/#{max_retries}"
      yield
    rescue => e
      if attempt < max_retries
        @logger.warn "Attempt #{attempt} failed: #{e.message}. Retrying in #{delay}s..."
        sleep delay
        retry
      else
        error_msg = "All #{max_retries} attempts failed: #{e.class} - #{e.message}\n#{e.backtrace.first(5).join("\n")}"
        @logger.error error_msg
        @errors << error_msg
        raise
      end
    end
  end
end