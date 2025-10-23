# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-10-23

### Added
- Complete rewrite as independent, focused Graylog MCP server
- Absolute timestamp search (`search_logs_absolute`) for debugging specific errors
- Relative timestamp search (`search_logs_relative`) for recent logs
- Stream discovery (`list_streams`) to find available applications
- System health check (`get_system_info`) to verify connectivity
- Comprehensive input validation with clear error messages
- ISO 8601 timestamp validation
- Stream ID filtering support
- Timeout handling (30 seconds)
- Production-ready error messages
- Comprehensive test suite (54 tests)
  - Unit tests for helper functions
  - Validation tests for all bug fixes
  - MCP protocol conformance tests
  - Integration tests for live Graylog instances
- Example Claude Desktop configuration
- Detailed README with usage examples
- Common query patterns documentation
- Troubleshooting guide

### Fixed
- **CRITICAL**: Message field access crash on malformed responses (Bug #1)
- **HIGH**: Missing rangeSeconds validation (Bug #2)
- **HIGH**: Missing streamId type validation (Bug #3)
- **MEDIUM**: Null query handling crash (Bug #4)
- **MEDIUM**: limit=0 bypassing default value (Bug #5)

### Changed
- Package name from `graylog-mcp-server` to `mcp-server-graylog`
- Architecture simplified to single file (429 lines)
- Dependencies reduced to 2 essential packages
- Error messages made more actionable
- Default limit set to 50 results
- Maximum time range limited to 24 hours (86400 seconds)

### Security
- Environment variable validation at startup
- API token authentication properly implemented
- No hardcoded credentials
- Input sanitization prevents injection attacks
- Error messages don't leak sensitive information

## [1.0.0] - 2025-10-20

### Added
- Initial release (cloned from lcaliani/graylog-mcp)
- Basic Graylog API integration
- Search functionality

### Known Issues
- 5 critical bugs identified by debugger agent
- Missing input validation
- No test coverage
- Incomplete error handling

---

## Future Releases

### [2.1.0] - Planned
- GitHub Actions CI/CD pipeline
- TypeScript type definitions (.d.ts)
- Additional query examples
- Performance optimizations

### [3.0.0] - Planned
- GraphQL query support
- Streaming logs support
- Advanced filtering options
- Dashboard integration
