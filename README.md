# Framework

Framework is a portable information-system specification and its reference TypeScript Kernel.

Builder.run is its first host. Teamloop and future products can use the same primitives while providing their own host, modules, persistence, and deployment environment.

The portable Spec is the product contract. The TypeScript Kernel is one consumer of that contract, not a requirement for consumers implemented with Laravel, WordPress, or another stack.

## Status

Greenfield and pre-release. There is no backwards-compatibility contract with the current Builder.run runtime.

## Development

```bash
vp install
vp check
vp test
vp pack
```

Start with the [framework documentation](docs/README.md).
