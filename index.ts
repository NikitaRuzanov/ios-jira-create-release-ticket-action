//const { request } = require("@octokit/request");
import * as github from '@actions/github';
import * as core from '@actions/core';
import * as JiraClient from 'jira.js';
import * as execa from 'execa';
import * as util from 'util';

main();

async function main() {
  if (!process.env.GITHUB_TOKEN) {
    core.setFailed(
      `GITHUB_TOKEN is not configured. Make sure you made it available to your action
  
  uses: bolteu/ios-jira-create-release-ticket-action@master
  env:
    GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`
    );
    return;
  }

  if (!process.env.GITHUB_REPOSITORY) {
    core.setFailed(
      'GITHUB_REPOSITORY missing, must be set to "<repo owner>/<repo name>"'
    );
    return;
  }
  if (!process.env.GITHUB_HEAD_REF) {
    core.setFailed(
      "GITHUB_HEAD_REF missing, must be set to the repository's default branch"
    );
    return;
  }

  try {
    const inputs = {
      jiraAccount: core.getInput("jiraAccount"),
      jiraToken: core.getInput("jiraToken"),
      jiraHost: core.getInput("jiraHost"),
      projectName: core.getInput("projectName"),
      versionSuffix: core.getInput("versionSuffix"),
      jiraProjectId: core.getInput("jiraProjectId"),
      jiraTaskTypeId: core.getInput("jiraTaskTypeId")
    };

    core.debug(`Inputs: ${util.inspect(inputs)}`);

    const token = core.getInput('github-token', {required: true})
    const octokit = github.getOctokit(token);
    let { owner, repo } = github.context.repo;

    // Testing stuff
    var jira_test = new JiraClient.Client({
      host: inputs.jiraHost,
      authentication: {
        basic: {
          username: inputs.jiraAccount,
          apiToken: inputs.jiraToken
        }
      }
    })
    await jira_test.issues.getCreateIssueMetadata({projectIds: [inputs.jiraProjectId]},
      (error: any, data: any) => {
        core.debug("Finished getting metadata")
        if (data) {
          core.debug(`Create task metadata -> ${data}`)
        }
        if (error) {
          core.debug(error)
        }
      })


    // checking the branch
    const brachRegexp = new RegExp(`release\/${inputs.versionSuffix}.\\d{1,2}.\\d{1,3}`)
    const brachVerification = process.env.GITHUB_HEAD_REF.match(/release/gmi)
    if (brachVerification == null) {
      const body = `Wrong brach format. Please fix it. Expected format is ${brachRegexp}`
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: github.context.issue.number,
        body
      });
      throw "Wrong branch format"
    }

    await runShellCommand(`git fetch origin ${process.env.GITHUB_HEAD_REF}`)

    var version = await runShellCommand(`sed -n '/MARKETING_VERSION/{s/MARKETING_VERSION = //;s/;//;s/^[[:space:]]*//;p;q;}' ./${inputs.projectName}.xcodeproj/project.pbxproj`)
    version = `${inputs.versionSuffix}.${version}`
    core.info("Version number is " + version)
    var jira = new JiraClient.Client({
      host: inputs.jiraHost,
      authentication: {
        basic: {
          username: inputs.jiraAccount,
          apiToken: inputs.jiraToken
        }
      }
    })

    core.info(`Creating ${version} for project -> ${inputs.jiraProjectId}` )
    await jira.projectVersions.createVersion({ projectId : +inputs.jiraProjectId, name: version }).catch(function(error: any) {
      core.info(error)
    });

    var errors: string[] = []

    core.info(`Searching for release ticket -> ${version}` )
    var shouldCreateNewReleaseTicket = false
    await jira.issueSearch.searchForIssuesUsingJqlGet({
      jql: `Release ${version}`
    }).then((result: { total: number; }) => {
      core.info(`Found number of release tickets -> ${result.total}` )
      shouldCreateNewReleaseTicket = result.total == 0
    })
    .catch(function(error: string) {
      core.info(error)
      // clear headers
      var printableError = JSON.parse(error)
      printableError.headers = null
      printableError.issue = printableError.request.uri.path
      printableError.request = null
      errors.push(JSON.stringify(printableError))
    })

    if (shouldCreateNewReleaseTicket) {
      core.info(`Creating relase ticket ${version} for project -> ${inputs.jiraProjectId}` )
      
      await jira.issues.createIssue({
        fields: { 
          project: { id: inputs.jiraProjectId }, 
          summary: `Release ${version}`, 
          issuetype: { id: inputs.jiraTaskTypeId } } 
      },
      (error: any, issue: any) => {
        if (issue) {
          core.info(`Created release ticket -> ${issue}`)
        }
        if (error) {
          core.info(error)
        }
      });
    }

    var body = `Release ticket has been created 🎉 `
    if (errors.length > 0) {
      body = body + `\n\n🆘 There are errors while creating release ticket: \n\n ${errors.join("\n\n")}`
    }
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: github.context.issue.number,
      body
    });

  } catch (error) {
    core.debug(util.inspect(error));
    core.setFailed(error.message);
  }
}

async function runShellCommand(commandString: string) {
  core.debug(`$ ${commandString}`);
  try {
    const { stdout, stderr } = await execa.command(commandString, { shell: true });
    const output = [stdout, stderr].filter(Boolean).join("\n");
    core.debug(output);
    return output;
  } catch (error) {
    core.debug(util.inspect(error));
    throw error;
  }
}


