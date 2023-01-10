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

const BUG_LABELS = ["Bug", "Release Blocker"];
const CHORE_LABELS = ["Chore"];
const FAST_TRACK_LABELS = ["Fast Track"];
const ALL_LABELS = [...BUG_LABELS, ...CHORE_LABELS, ...FAST_TRACK_LABELS];

const getBugs = async (linearClient, stateIds, label) =>
  await getIssues(linearClient, stateIds, label, BUG_LABELS);

const getChores = async (linearClient, stateIds, label) =>
  await getIssues(linearClient, stateIds, label, CHORE_LABELS);

const getFastTracks = async (linearClient, stateIds, label) =>
  await getIssues(linearClient, stateIds, label, FAST_TRACK_LABELS);

const getOther = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      labels: {
        and: [
          { every: { name: { nin: ALL_LABELS } } },
          label ? { name: { eq: label } } : {},
        ],
      },
      state: { id: { in: stateIds } },
      project: { null: true },
    },
  });

  return removeChildIssues(issues);
};

const getIssues = async (linearClient, stateIds, releaseLabel, typeLabels) => {
  const issues = await linearClient.issues({
    filter: {
      labels: {
        and: [
          { name: { in: typeLabels } },
          releaseLabel ? { name: { eq: releaseLabel } } : {},
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
    const other = await getOther(linearClient, stateIds, label);
    const projects = await getProjects(linearClient, stateIds, label);

    core.setOutput("has-issues", hasIssues(bugs, chores, fastTracks));

    const releaseNotes = `
*Fast Track*
${formatIssues(fastTracks)}
*Bugfixes*
${formatIssues(bugs)}
*Chores*
${formatIssues(chores)}
*Other*
${formatIssues(other)}
*Projects*
${formatProjects(projects)}
  `;

    core.setOutput("release-notes", releaseNotes);
  } catch (error) {
    core.setFailed(error.message);
  }
};

run();
