# Contributing to mcp-server-graylog

Thank you for considering contributing to mcp-server-graylog! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Enhancements](#suggesting-enhancements)

## Code of Conduct

This project adheres to a simple code of conduct: **Be respectful, be collaborative, be helpful.**

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates.

When creating a bug report, include:
- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs **actual behavior**
- **Environment details** (Node.js version, Graylog version, OS)
- **Error messages** or logs (if applicable)
- **Screenshots** (if applicable)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:
- **Clear title** describing the enhancement
- **Detailed description** of the proposed functionality
- **Use case** explaining why this would be useful
- **Examples** of how it would work

### Contributing Code

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests for your changes
5. Ensure all tests pass (`npm test`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to your fork (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- Access to a Graylog instance (for integration tests)

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/graylog-mcp.git
cd graylog-mcp

# Install dependencies
npm install

# Run syntax check
npm run lint

# Run tests
npm test
```

### Development Workflow

```bash
# Start development server (auto-reload)
npm run dev

# Run tests in watch mode
npm run test:watch

# Run unit tests only
npm run test:unit

# Run integration tests (requires Graylog instance)
INTEGRATION_TESTS=true BASE_URL=https://graylog.example.com API_TOKEN=xxx npm run test:integration
```

## Testing

**All code contributions must include tests.**

### Test Structure

- `test/helpers.test.js` - Helper function tests
- `test/validation.test.js` - Input validation tests
- `test/mcp-protocol.test.js` - MCP protocol conformance tests
- `test/integration.test.js` - Integration tests (requires live Graylog)

### Writing Tests

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Feature Name', () => {
    it('should do something specific', () => {
        // Arrange
        const input = 'test';

        // Act
        const result = functionToTest(input);

        // Assert
        assert.strictEqual(result, 'expected');
    });
});
```

### Test Guidelines

- Write descriptive test names
- Test both success and failure cases
- Test edge cases (null, undefined, empty, invalid types)
- Keep tests focused and isolated
- Use `assert` from `node:assert` (built-in)
- Integration tests should be skippable (use `INTEGRATION_TESTS` env var)

## Pull Request Process

1. **Update documentation** - Update README.md if you change functionality
2. **Update CHANGELOG.md** - Add entry under `[Unreleased]` section
3. **Ensure tests pass** - Run `npm test` and verify all tests pass
4. **Verify package builds** - Run `npm pack` and check contents
5. **Write clear commit messages** - Use conventional commit format
6. **Keep PRs focused** - One feature/fix per PR
7. **Respond to feedback** - Address review comments promptly

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): brief description

Detailed description (optional)

Breaking changes (optional)
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Build/tooling changes

**Examples:**
```
feat(search): add support for regex queries
fix(validation): prevent crash on null streamId
docs(readme): add troubleshooting section
test(validation): add edge case tests for limit parameter
```

## Code Style

### General Guidelines

- Use ES modules (`import`/`export`)
- Use `const` and `let`, never `var`
- Use async/await instead of callbacks
- Keep functions small and focused
- Use descriptive variable names
- Add comments for complex logic
- Follow existing code style

### Code Organization

```javascript
// ============================================================================
// SECTION NAME
// ============================================================================

function helperFunction() {
    // Implementation
}

async function mainFunction() {
    // Implementation
}
```

### Error Handling

```javascript
// Always provide actionable error messages
throw new Error("'parameter' is required and must be a string");

// Not: throw new Error("Invalid input");
```

### Input Validation

```javascript
// Validate at boundaries
if (!param || typeof param !== 'string' || !param.trim()) {
    throw new Error("'param' is required and must be a non-empty string");
}

// Use nullish coalescing for defaults
const limit = args.limit ?? 50;

// Not: const limit = args.limit || 50; (fails for 0)
```

## Architecture

### File Structure

```
mcp-server-graylog/
├── src/
│   └── index.js           # Main server implementation (single file)
├── test/
│   ├── helpers.test.js    # Helper function tests
│   ├── validation.test.js # Input validation tests
│   ├── mcp-protocol.test.js # MCP protocol tests
│   └── integration.test.js  # Integration tests
├── example-config.json    # Claude Desktop config example
├── package.json          # npm package configuration
├── README.md            # User documentation
├── CHANGELOG.md         # Version history
├── CONTRIBUTING.md      # This file
└── LICENSE             # MIT license
```

### Key Design Principles

1. **Simplicity** - Single file, easy to understand
2. **Focused** - Does one thing well (Graylog log searching)
3. **Robust** - Comprehensive validation and error handling
4. **Tested** - High test coverage (54+ tests)
5. **Documented** - Clear, actionable documentation

### MCP Protocol Adherence

All changes must maintain compatibility with the Model Context Protocol specification:

- Use `@modelcontextprotocol/sdk` for server implementation
- Follow JSON-RPC 2.0 format
- Return content in `{ type: "text", text: "..." }` format
- Set `isError: true` for error responses
- Handle notifications (messages without `id`)

## Release Process

Maintainers will handle releases. The process is:

1. Update version in `package.json`
2. Update `CHANGELOG.md` with release date
3. Create git tag (`git tag v2.0.0`)
4. Push tag (`git push origin v2.0.0`)
5. Publish to npm (`npm publish`)
6. Create GitHub release with changelog

## Questions?

Feel free to open an issue for:
- Questions about contributing
- Clarification on guidelines
- Discussion about features or changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to mcp-server-graylog! 🚀
