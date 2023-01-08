# Linear Release Action

Generate release notes.

## Inputs

### `linearToken`

_Required._ Linear API key.

### `stateId`

_Optional._ The workflow state id to which the issues are assigned to.

### `label`

_Optional._ The label name to which the issues are assigned to.

## Outputs

### `release-notes`

Release notes.

### `has-issue`

Did the release contain any Linear issues.

## Example usage

```yaml
uses: perdoo/linear-release-action@v0.1.0
with:
  linearApiKey: ${{ secrets.LINEAR_API_KEY }}
  label: v0.1.0
```
