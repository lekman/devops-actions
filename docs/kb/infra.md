# Infrastructure Failures

Covers Pulumi preview and deploy failures in the **infra-preview** CI job.

The infra-preview job runs on pull requests when a Pulumi project or the policy pack changes. It signs in to Azure with OIDC and runs `pulumi preview` for each project. On push to main, the infra-apply job runs `pulumi up` for each project against the same stack, independently of the container pipeline. The older deploy job, which applies after a container image is built, is unchanged.

## Projects, Stack, Policy Pack and Environment

Four `workflow_call` inputs describe the infrastructure, all optional. Without them the workflow behaves as before: one project at `infra/`, the stack from `PULUMI_STACK_NAME` or `prod`, no policy pack.

```yaml
jobs:
  ci:
    uses: lekman/devops-toolkit/.github/workflows/ci.yml@main
    secrets: inherit
    with:
      pulumi-projects: |
        packages/infrastructure/customer
        packages/infrastructure/service
      pulumi-stack: my-org/staging
      pulumi-policy-pack: packages/infrastructure/policy
      pulumi-organization: my-org
      pulumi-environment: staging
```

| Input                | What it does                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pulumi-projects`    | One directory per line. Each holding a `Pulumi.yaml` becomes a matrix entry for preview and apply. The infra change filter covers every listed directory                            |
| `pulumi-stack`       | Stack for both preview and apply, organisation-qualified when the stack lives in a Pulumi Cloud organisation. Falls back to `PULUMI_STACK_NAME`, then `prod`                        |
| `pulumi-policy-pack` | A CrossGuard policy pack directory. Its dependencies are installed with bun and it runs with every preview and apply, so a preview that violates a mandatory rule fails the gate |
| `pulumi-organization` | Sign in to Pulumi Cloud with the job's OIDC token instead of a stored `PULUMI_ACCESS_TOKEN`. The organisation registers `https://token.actions.githubusercontent.com` under Settings, Access Management, OIDC Issuers, with an Allow policy for token type Organization, audience `urn:pulumi:org:<org>` and subject `repo:<owner>/<repo>:*`. Team edition or above |
| `pulumi-environment` | The GitHub environment both jobs run in. It names the OIDC subject Azure sees, `repo:<owner>/<repo>:environment:<name>`, which must match a federated credential on the identity |

The preview job runs in the environment too. A pull request job without an environment presents the subject `pull_request`, which no federated credential written for `main` or for an environment matches, and the login fails before Pulumi runs.

The apply job needs the `quality` and `security` jobs to have passed, runs one project at a time per environment, and never cancels a run in progress. Its `ARM_*` variables come from the GitHub environment, so the same workflow applies a different subscription per environment.

## Azure OIDC Login

| Symptom                                                        | Cause                                                          | Fix                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AADSTS700016: Application not found`                          | `ARM_CLIENT_ID` does not match a registered Azure AD app       | Verify the client ID in repository secrets matches the Azure AD app registration                                       |
| `AADSTS70021: No matching federated identity credential found` | OIDC subject claim does not match the federated credential     | Check the federated credential's subject matches `repo:org/repo:ref:refs/heads/branch` or `repo:org/repo:pull_request` |
| `ARM_TENANT_ID` or `ARM_SUBSCRIPTION_ID` missing               | Environment variable not set in the workflow                   | Add the variable to the repository or environment secrets                                                              |
| Login succeeds but Pulumi fails with `AuthorizationFailed`     | Service principal lacks permissions on the target subscription | Grant the required RBAC role (e.g., Contributor) on the subscription or resource group                                 |

## Pulumi Errors

| Symptom                                           | Cause                                                     | Fix                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PULUMI_ACCESS_TOKEN` missing or expired          | Token not set or has been rotated                         | Update the `PULUMI_ACCESS_TOKEN` secret in GitHub                                                           |
| `stack not found`                                 | Stack name does not match a stack in the Pulumi backend   | Check the `stack-name` input matches an existing stack. Create the stack with `pulumi stack init` if needed |
| `error: update conflict`                          | Another Pulumi operation is in progress on the same stack | Wait for the other operation to finish, or run `pulumi cancel` if it is stuck                               |
| `bun install --frozen-lockfile` fails in `infra/` | Infrastructure package lockfile is out of sync            | Run `bun install` in the `infra/` directory locally and commit the updated `bun.lock`                       |
| Preview shows unexpected resource changes         | Infrastructure state has drifted from code                | Review the diff carefully. Run `pulumi refresh` to sync state with the actual cloud resources               |

## Pulumi Preview on PRs

The preview report on a pull request comes from the Pulumi GitHub App,
installed on the repository and linked to the Pulumi Cloud organisation. It
posts the resource changes with a link to the update in Pulumi Cloud, once
per preview. The workflow does not post a second copy: `comment-on-pr` on
the pulumi action defaults to `false`, and the preview job leaves it there.
Set it to `true` only in a repository where the App is not installed.

## Required Permissions

The infra-preview job requires:

- `id-token: write` — for Azure OIDC federated authentication
- `contents: read` — to checkout code
- `pull-requests: write` — only when `comment-on-pr` is set to `true`

## Local Reproduction

```bash
cd infra/
bun install
pulumi preview --stack <stack-name>
```

Ensure Azure credentials are configured locally via `az login` or environment variables.
