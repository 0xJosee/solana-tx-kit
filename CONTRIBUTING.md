# Contributing to solana-tx-kit

## Prerequisites

- Node.js 18+
- pnpm 9+

## Dev Setup

```bash
git clone https://github.com/solana-tx-kit/solana-tx-kit.git
cd solana-tx-kit
pnpm install
```

## Scripts

| Command | Description |
| --- | --- |
| `pnpm run lint` | Run biome linting and format checking |
| `pnpm run typecheck` | Run TypeScript type checking |
| `pnpm run test` | Run tests with vitest |
| `pnpm run build` | Build the library with tsup |

Run all checks before submitting a PR:

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build
```

## Code Standards

- **TypeScript**: Strict mode enabled. No `any` types without justification.
- **Linting and formatting**: Handled by [Biome](https://biomejs.dev/). Run `pnpm run lint` to check.
- **Testing**: Write tests with [vitest](https://vitest.dev/). All new features and bug fixes should include tests.

## Pull Request Process

1. Fork the repository and create a branch from `main`.
2. Make your changes. Keep commits focused and well-described.
3. Write or update tests for your changes.
4. Ensure all checks pass: linting, type checking, tests, and build.
5. Open a pull request against `main` with a clear description of what changed and why.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
