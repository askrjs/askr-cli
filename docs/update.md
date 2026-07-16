# update

`askr outdated`, `askr update`, and `askr upgrade` manage dependency updates with Askr-owned logic and no install
step. `outdated` is read-only, `update` writes safe changes, and `upgrade` writes
latest-version changes that pass peer compatibility.

```bash
askr outdated
askr update
askr upgrade
askr update vite "@types/*"
askr update --workspace "@scope/app"
askr update --tag next
askr update --cwd ./packages/app
askr update --json
```

## Options

| Option               | Behavior                                                     |
| -------------------- | ------------------------------------------------------------ |
| `--cwd <dir>`        | Start project discovery from another directory.              |
| `--workspace <glob>` | Select workspace package names. Repeat for more filters.     |
| `--tag <tag>`        | Resolve every selected package through this dist-tag.        |
| `--json`             | Write one deterministic result object to stdout.             |

Positional package names are minimatch patterns. When any are supplied, they
select the package set directly and override matching persistent ignores.

## Workspace discovery

Starting at `--cwd` or the current directory, the command finds the nearest
containing workspace root. If there is no workspace root, it uses the nearest
`package.json`. Both `package.json#workspaces` forms and
`pnpm-workspace.yaml#packages` are supported.

The root manifest is always included. Only declared workspace globs are mapped;
undeclared siblings, `node_modules`, and build output are not recursively
scanned. Use the root package name with `--workspace` to select only the root.
Duplicate workspace names, malformed manifests, and invalid workspace
declarations fail before registry access.

The updater scans `dependencies`, `devDependencies`, `optionalDependencies`,
and `peerDependencies`. Discovered workspace names and local protocols are
treated as local. npm aliases and unsupported ranges are reported for manual
review.

## Policy

Policy is read only from the selected workspace root:

```json
{
  "askr": {
    "update": {
      "ignore": ["typescript", "@types/*"],
      "tags": {
        "vite-plus": "next"
      }
    }
  }
}
```

`--tag` overrides configured package tags. An explicit positional package
selection overrides ignores. Otherwise package tags take precedence over the
default `latest` tag.

## Compatibility and range changes

The selected dist-tag is compared with the highest published version currently
allowed by each range. A stable-package major change is breaking. Before `1.0`,
a minor change is breaking and a patch change is compatible.

| Current specification    | `askr update` result                                      | `askr upgrade` result                              |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------- |
| Exact version            | Exact target                                              | Exact target                                       |
| Caret, tilde, or x-range | Preserve its style around the target                      | Rebase the same style                              |
| One bounded interval     | Keep its lower bound and expand the compatibility ceiling | Rebase to `>=target <next-breaking-boundary`       |
| Simple OR union          | Change only its highest clause                            | Replace the union using its highest clause's style |
| Wildcard or tracking tag | No manifest change                                        | No manifest change                                 |
| Complex or hyphen range  | Manual review                                             | Manual review                                      |

Before any write, Askr also resolves the selected/current versions of
co-dependencies and checks their published `peerDependencies`. A proposal is
blocked as manual when it would turn an accepted peer version into a rejected
one. For example, TypeScript 7 is not proposed while the selected Vite Plus
version declares a TypeScript 6 peer range. `askr upgrade` does not bypass peer
compatibility.

## npm configuration and failures

The command loads npm's project, user, global, environment, proxy, TLS, cache,
scoped-registry, and authentication configuration with npm's own configuration
stack. Registry metadata is revalidated online, fetched at most once per
package, and limited to eight concurrent requests.

Any required registry, tag, configuration, or write failure makes the complete
plan fail with exit code `1`; no manifest edits are retained. Diagnostics never
include npm configuration, headers, tokens, or credential-bearing registry
URLs. A successful scan or write exits `0`, even when safe or breaking updates
remain.

In JSON mode stdout contains one object with the root, selected workspaces,
summary counts, sorted package decisions, applied occurrence count, and
sanitized errors. Diagnostics go to stderr.

## Manifest-only boundary

Writes are value-only JSON edits that preserve unrelated formatting, key order,
line endings, indentation, and trailing-newline state. All registry resolution
and planning finishes before temporary files are staged. Multi-manifest writes
replace files deterministically and roll back completed replacements if a later
replacement fails.

Neither mutation command writes lockfiles, installs dependencies, runs lifecycle
scripts, or manages overrides, resolutions, catalogs, `packageManager`, or
interactive selection. Named dist-tags are the supported prerelease channel.
