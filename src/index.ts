import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as downloader from './downloader'
import { initFermyonClient, getSpinConfig } from './fermyon'
import * as sys from './system'
import * as github from '@actions/github';
import * as octokit from 'octokit'
import * as octocore from '@octokit/core'
import { RequestParameters } from "@octokit/types";
import * as io from '@actions/io'

async function run(): Promise<void> {
  try {
    core.info("is this?")
    core.info(`context ${JSON.stringify(github.context.payload)}`)
    if (!github.context.payload.pull_request) {
      throw `its not a pull request`
    }

    //setup spin
    const spinVersion = 'v0.8.0'
    core.info(`setting up spin ${spinVersion}`)
    const downloadUrl = `https://github.com/fermyon/spin/releases/download/${spinVersion}/spin-${spinVersion}-linux-amd64.tar.gz`
    await downloader
      .getConfig(`spin`, downloadUrl, `spin`)
      .download()

    //setup plugins if needed
    const plugins = core.getInput('plugins') !== '' ? core.getInput('plugins').split(',') : [];
    if (plugins.length > 0) {
      await exec.exec('spin', ['plugin', 'update'])
      plugins.every(async function (plugin) {
        core.info(`setting up spin plugin '${plugin}'`);
        //TODO: use Promise.All
        await exec.exec('spin', ['plugin', 'install', plugin, '--yes'])
      })
    }

    const spinConfig = getSpinConfig()
    const ghclient = new octokit.Octokit()

    core.info("creating Fermyon client")
    const fermyonClient = initFermyonClient()
    // check if token file found, if so read it into a struct
    // get number of apps
    core.info("checking if we have room for this preview")
    const apps = await fermyonClient.getAllApps()
    const previewExists = apps.find(item => item.name === spinConfig.name)
    // if > 5, and overwrite enabled, delete the oldest
    // check if our app is already deployed as preview
    if (!previewExists && apps.length >= 5) {
      if (core.getInput("overwrite_old_previews") !== 'true') {
        throw `max apps allowed limit exceeded. max_allowed: 5, current_apps_count: ${apps.length}. Use option 'overwrite_old_previews=true' to overwrite old previews`
      }

      //find oldest pr
      const q = `org:${github.context.repo.owner} repo:${github.context.repo.repo} is:open is:pr`;
      const result = await ghclient.rest.search.issuesAndPullRequests({ q, sort: 'updated', order: "asc" })
      if (result.data.items.length === 0) {
        throw `app limits reached on cloud but no old pr found to remove`
      }

      await fermyonClient.deleteAppByName(`${spinConfig.name}-pr-${result.data.items[0].number}`)
    }

    // deploy new app
    await io.cp("/github/workspace/developer-docs-preview.json", "/home/runner/.config/fermyon/config.json")
    await fermyonClient.deploy(`${spinConfig.name}-pr-${github.context.payload.pull_request?.number}`)

    // update comment
    ghclient.rest.issues.createComment({ owner: github.context.repo.owner, repo: github.context.repo.repo, issue_number: github.context.payload.pull_request?.number, body: "Your preview is available at" })

    // add label
    ghclient.rest.issues.addLabels({ owner: github.context.repo.owner, repo: github.context.repo.repo, issue_number: github.context.payload.pull_request?.number, labels: ["fermyon-preview-deployed"] })
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
