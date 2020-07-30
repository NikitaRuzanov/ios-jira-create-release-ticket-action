"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("util");
const execa_1 = require("execa");
const core_1 = __importDefault(require("@actions/core"));
//const { request } = require("@octokit/request");
const jira_js_1 = require("jira.js");
const github_1 = require("@actions/github");
main();
async function main() {
    if (!process.env.GITHUB_TOKEN) {
        core_1.default.setFailed(`GITHUB_TOKEN is not configured. Make sure you made it available to your action
  
  uses: bolteu/ios-jira-create-release-ticket-action@master
  env:
    GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}`);
        return;
    }
    if (!process.env.GITHUB_REPOSITORY) {
        core_1.default.setFailed('GITHUB_REPOSITORY missing, must be set to "<repo owner>/<repo name>"');
        return;
    }
    if (!process.env.GITHUB_HEAD_REF) {
        core_1.default.setFailed("GITHUB_HEAD_REF missing, must be set to the repository's default branch");
        return;
    }
    try {
        const inputs = {
            jiraAccount: core_1.default.getInput("jiraAccount"),
            jiraToken: core_1.default.getInput("jiraToken"),
            jiraHost: core_1.default.getInput("jiraHost"),
            projectName: core_1.default.getInput("projectName"),
            versionSuffix: core_1.default.getInput("versionSuffix"),
            jiraProjectId: +core_1.default.getInput("jiraProjectId"),
            jiraTaskTypeId: +core_1.default.getInput("jiraTaskTypeId")
        };
        core_1.default.debug(`Inputs: ${util_1.inspect(inputs)}`);
        const token = core_1.default.getInput('github-token', { required: true });
        const client = new github_1.GitHub(token, {});
        // checking the branch
        const brachRegexp = new RegExp(`release\/${inputs.versionSuffix}.\\d{1,2}.\\d{1,3}`);
        const brachVerification = process.env.GITHUB_HEAD_REF.match(/release/gmi);
        if (brachVerification == null) {
            const body = `Wrong brach format. Please fix it. Expected format is ${brachRegexp}`;
            await client.issues.createComment({ ...github_1.context.issue, body: body });
            throw "Wrong branch format";
        }
        await runShellCommand(`git fetch origin ${process.env.GITHUB_HEAD_REF}`);
        var version = await runShellCommand(`sed -n '/MARKETING_VERSION/{s/MARKETING_VERSION = //;s/;//;s/^[[:space:]]*//;p;q;}' ./${inputs.projectName}.xcodeproj/project.pbxproj`);
        version = `${inputs.versionSuffix}.${version}`;
        core_1.default.info("Version number is " + version);
        var jira = new jira_js_1.Client({
            host: inputs.jiraHost,
            authentication: {
                basic: {
                    username: inputs.jiraAccount,
                    apiToken: inputs.jiraToken
                }
            }
        });
        core_1.default.info(`Creating ${version} for project -> ${inputs.jiraProjectId}`);
        await jira.projectVersions.createVersion({ projectId: inputs.jiraProjectId, name: version }).catch(function (error) {
            core_1.default.info(error);
        });
        var errors = [];
        core_1.default.info(`Searching for release ticket -> ${version}`);
        var shouldCreateNewReleaseTicket = false;
        await jira.issueSearch.searchForIssuesUsingJqlGet({
            jql: `Release ${version}`
        }).then((result) => {
            core_1.default.info(`Found number of release tickets -> ${result.total}`);
            shouldCreateNewReleaseTicket = result.total == 0;
        })
            .catch(function (error) {
            core_1.default.info(error);
            // clear headers
            var printableError = JSON.parse(error);
            printableError.headers = null;
            printableError.issue = printableError.request.uri.path;
            printableError.request = null;
            errors.push(JSON.stringify(printableError));
        });
        if (shouldCreateNewReleaseTicket) {
            core_1.default.info(`Creating relase ticket ${version} for project -> ${inputs.jiraProjectId}`);
            await jira.issues.createIssue({
                fields: {
                    project: { id: inputs.jiraProjectId },
                    summary: `Release ${version}`,
                    issuetype: { id: inputs.jiraTaskTypeId }
                }
            }, (error, issue) => {
                if (issue) {
                    core_1.default.info(`Created release ticket -> ${issue}`);
                }
                if (error) {
                    core_1.default.info(error);
                }
            });
        }
        var body = `Release ticket has been created 🎉 `;
        if (errors.length > 0) {
            body = body + `\n\n🆘 There are errors while creating release ticket: \n\n ${errors.join("\n\n")}`;
        }
        await client.issues.createComment({ ...github_1.context.issue, body: body });
    }
    catch (error) {
        core_1.default.debug(util_1.inspect(error));
        core_1.default.setFailed(error.message);
    }
}
async function runShellCommand(commandString) {
    core_1.default.debug(`$ ${commandString}`);
    try {
        const { stdout, stderr } = await execa_1.command(commandString, { shell: true });
        const output = [stdout, stderr].filter(Boolean).join("\n");
        core_1.default.debug(output);
        return output;
    }
    catch (error) {
        core_1.default.debug(util_1.inspect(error));
        throw error;
    }
}
