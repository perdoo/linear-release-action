import * as core from "@actions/core";
import { LinearClient } from "@linear/sdk";

const ESCAPE = {
  ">": "&gt;",
  "<": "&lt;",
  "&": "&amp;",
  "\r\n": " ",
  "\n": " ",
  "\r": " ",
};
const ESPACE_REGEX = new RegExp(Object.keys(ESCAPE).join("|"), "gi");

const getBugs = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      labels: {
        and: [
          { name: { in: ["Bug", "Release Blocker"] } },
          label ? { name: { eq: label } } : {},
        ],
      },
      state: { id: { in: stateIds } },
      project: { null: true },
    },
  });

  return removeChildIssues(issues);
};

const getChores = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      labels: {
        and: [{ name: { eq: "Chore" } }, label ? { name: { eq: label } } : {}],
      },
      state: { id: { in: stateIds } },
      project: { null: true },
    },
  });

  return removeChildIssues(issues);
};

const getFastTracks = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      labels: {
        and: [
          { every: { name: { nin: ["Bug", "Chore", "Release Blocker"] } } },
          label ? { name: { eq: label } } : {},
        ],
      },
      state: { id: { in: stateIds } },
      project: { null: true },
    },
  });

  return removeChildIssues(issues);
};

const getProjects = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      project: { null: false },
      state: { id: { in: stateIds } },
      labels: label ? { name: { eq: label } } : {},
    },
  });
  const projects = {};

  for (const issue of issues.nodes) {
    if (!(issue._project.id in projects)) {
      projects[issue._project.id] = await issue.project;
    }
  }

  return Object.values(projects).sort(
    (first, second) => second.progress - first.progress
  );
};

const removeChildIssues = (issues) => {
  issues.nodes = issues.nodes.filter((issue) => issue._parent === undefined);
  return issues;
};

const formatIssues = (issues) =>
  issues.nodes
    .map(({ title, url }) => `- <${url}|${escapeText(title)}>`)
    .join("\n") || "_No tickets_";

const escapeText = (text) =>
  text.replace(ESPACE_REGEX, (match) => ESCAPE[match]);

const formatProjects = (projects) =>
  projects
    .map(({ name, url, progress, targetDate }) => {
      name = `<${url}|${escapeText(name)}>`;
      progress = formatProgress(progress);
      targetDate = formatTargetDate(targetDate);
      return `- ${name}, Progress: ${progress}, Target stage release date: ${targetDate}`;
    })
    .join("\n") || "_No projects_";

const formatProgress = (progress) =>
  progress === 1 ? "Completed" : `${(progress * 100).toFixed()}%`;

const formatTargetDate = (targetDate) =>
  targetDate ? `${new Date(targetDate).toLocaleDateString("de-DE")}` : "/";

const hasIssues = (...lists) => lists.some(({ nodes }) => nodes.length);

const run = async () => {
  try {
    const linearToken = core.getInput("linearToken");
    const linearClient = new LinearClient({ apiKey: linearToken });
    const stateIds = core.getInput("stateIds")
      ? core.getInput("stateIds").split(",")
      : undefined;
    const label = core.getInput("label");
    core.setSecret("linearToken");

    if (!stateIds && !label) {
      core.info("Either `stateIds` or `label` must be provided.");
      return;
    }

    const bugs = await getBugs(linearClient, stateIds, label);
    const chores = await getChores(linearClient, stateIds, label);
    const fastTracks = await getFastTracks(linearClient, stateIds, label);
    const projects = await getProjects(linearClient, stateIds, label);

    core.setOutput("has-issues", hasIssues(bugs, chores, fastTracks));

    const releaseNotes = `
*Fast Track*
${formatIssues(fastTracks)}
*Bugfixes*
${formatIssues(bugs)}
*Chores*
${formatIssues(chores)}
*Projects*
${formatProjects(projects)}
  `;

    core.setOutput("release-notes", releaseNotes);
  } catch (error) {
    core.setFailed(error.message);
  }
};

run();
