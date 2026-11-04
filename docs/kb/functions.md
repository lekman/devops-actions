# Publishing to Azure Functions

The function-publish job sends the Python project in `python-dir` to a Flex Consumption function app on push to main. It runs after quality, security and the infrastructure apply, and it publishes nothing unless its own audit of the resolved dependencies is clean.

## Inputs

| Input                         | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `function-app`                | The app to publish to. Empty, the default, means no publish.   |
| `function-app-resource-group` | The resource group holding the app.                            |
| `python-dir`                  | The project directory; it must hold `function_app.py`.         |
| `pulumi-environment`          | The GitHub environment whose `ARM_*` variables sign in to Azure |

## How the Package Reaches the App

One deploy is the only deployment path on Flex Consumption. The job zips the project root without tests, caches, virtual environments and repository metadata, and hands it to `az functionapp deployment source config-zip` with a remote build. The platform builds the package on its own Linux host, which is what Microsoft recommends for Python, stores it in the app's deployment container with the app's own identity, and restarts the app. The job itself needs Contributor on the resource group and nothing on storage.

The upload goes through the app's SCM site. An app that restricts inbound access must therefore list the runner's address on both the main and the SCM allow-list, or the publish is refused with a 403.

## The Audit Is the Gate Here

The audit job earlier in the pipeline reports advisories to the quality gate without failing, so a finding does not hide the other dimensions. The publish job runs the same audit again with `fail-on-vulnerability` on. A package with a known vulnerability is not published, whatever else is green. Fix or upgrade the dependency, or record a suppression the reviewer can see, and the next push publishes.

## What Counts as Done

After the upload the job asks the app which functions it loaded and fails if the answer is empty. A publish the platform accepted but the host loaded nothing from is the shape a broken package takes, and it would otherwise look like a success.

## Not Supported

Custom containers. Flex Consumption runs packages only; a containerised function needs a Premium or Dedicated plan or Azure Container Apps, and a different job.
