import sys
import os
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

def test_import_core_modules():
    """Test that core modules can be imported"""
    try:
        from src import config
        from src import utils
        from src import models
        assert True, "Core modules imported successfully"
    except ImportError as e:
        assert False, f"Failed to import core modules: {e}"

def test_config_values():
    """Test configuration values are set correctly"""
    from src import config
    
    # This assertion is failing - config.DEBUG should be False in production
    assert config.DEBUG == False, f"DEBUG mode is enabled ({config.DEBUG}) but should be False"
    
    assert hasattr(config, 'DATABASE_URL'), "DATABASE_URL not configured"
    assert config.DATABASE_URL != "", "DATABASE_URL is empty"
    
    assert hasattr(config, 'API_VERSION'), "API_VERSION not configured"
    assert config.API_VERSION == "v1", f"API_VERSION is {config.API_VERSION} but should be v1"

def test_database_connection():
    """Test database connectivity"""
    from src import database
    
    try:
        conn = database.get_connection()
        assert conn is not None, "Database connection is None"
        
        # This assertion is failing - database.test_connection() returns False
        result = database.test_connection()
        assert result == True, f"Database connection test failed: {result}"
        
    except Exception as e:
        assert False, f"Database connection error: {e}"

def test_api_endpoints():
    """Test API endpoint configuration"""
    from src import api
    
    endpoints = api.get_registered_endpoints()
    assert len(endpoints) > 0, "No API endpoints registered"
    
    # This assertion is failing - health endpoint missing
    assert '/health' in endpoints, f"Health endpoint not found in {endpoints}"
    assert '/api/v1/status' in endpoints, f"Status endpoint not found in {endpoints}"

def test_authentication_module():
    """Test authentication module initialization"""
    from src import auth
    
    assert hasattr(auth, 'verify_token'), "verify_token function not found"
    assert hasattr(auth, 'create_token'), "create_token function not found"
    
    # This assertion is failing - token expiry should be 3600
    assert auth.TOKEN_EXPIRY == 3600, f"TOKEN_EXPIRY is {auth.TOKEN_EXPIRY} but should be 3600"

def test_logging_setup():
    """Test logging is properly configured"""
    from src import logger
    
    assert logger.is_configured(), "Logger not configured"
    
    log_level = logger.get_level()
    assert log_level == "INFO", f"Log level is {log_level} but should be INFO"

def run_smoke_tests():
    """Run all smoke tests and report results"""
    tests = [
        test_import_core_modules,
        test_config_values,
        test_database_connection,
        test_api_endpoints,
        test_authentication_module,
        test_logging_setup
    ]
    
    failed = []
    passed = []
    
    for test in tests:
        try:
            test()
            passed.append(test.__name__)
            print(f"✓ {test.__name__}")
        except AssertionError as e:
            failed.append((test.__name__, str(e)))
            print(f"✗ {test.__name__}: {e}")
        except Exception as e:
            failed.append((test.__name__, f"Unexpected error: {e}"))
            print(f"✗ {test.__name__}: Unexpected error: {e}")
    
    print(f"\n{'='*60}")
    print(f"Passed: {len(passed)}/{len(tests)}")
    print(f"Failed: {len(failed)}/{len(tests)}")
    
    if failed:
        print("\nFailed tests:")
        for name, error in failed:
            print(f"  - {name}")
            print(f"    {error}")
        sys.exit(1)
    else:
        print("\nAll smoke tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    run_smoke_tests()