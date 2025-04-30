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

const STAGE_FEATURES_ID = "b19b3699-bcb0-40b1-a6a6-84b653413afe";
const STAGE_CHORES_ID = "0e0387d8-d7cb-4284-95a6-96c7f77aeee8";
const STAGE_BUGS_ID = "169bfe5a-c896-4175-91c7-5bdc39217c2f";

const BUG_LABELS = ["Bug", "Release Blocker"];
const CHORE_LABELS = ["Chore"];
const FEATURE_LABELS = ["Feature"];
const ALL_LABELS = [...BUG_LABELS, ...CHORE_LABELS, ...FEATURE_LABELS];

const daysAgo = (date) => {
  const now = new Date(); // Current date and time
  const timeDifference = now.getTime() - date.getTime(); // Difference in milliseconds
  const millisecondsInDay = 1000 * 60 * 60 * 24; // Milliseconds in a day

  // Convert time difference to days
  return Math.floor(timeDifference / millisecondsInDay);
}

const removeChildIssues = (issues) => {
  issues.nodes = issues.nodes.filter((issue) => issue._parent === undefined);
  return issues;
};

const assignees = {
  "a3005857-9dae-4542-a362-f1c4c951affb": "<@U025B250BP0>", // diggy
  "4d935ad5-cd47-48f9-8267-1f1d41c0a08b": "<@U033SAW6E>", // jonny
  "308eaad1-562f-4e7b-b4dc-c167ca2aa716": "<@U07GU74JBS5>" // bogdan
}

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
    },
  });

  return removeChildIssues(issues);
};

const getInProgressIssues = async (linearClient, stateIds = []) => {
  const stageStates = [STAGE_FEATURES_ID, STAGE_BUGS_ID, STAGE_CHORES_ID];
  const inProgressStates = stageStates.filter(state => !stateIds.includes(state));
  const issues = await linearClient.issues({
    filter: {
      or: [
        {
          state: {
            type: { eq: "started" },
          },
        },
        {
          state: {
            id: {
              in: inProgressStates,
            },
          },
        },
      ],
    },
  });

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
    },
  });

  return removeChildIssues(issues);
};

const withoutChildren = removeChildIssues(issues);
  withoutChildren.nodes.sort((a, b) => a.startedAt?.getTime() - b.startedAt?.getTime());
  return withoutChildren;
};

const getBugs = async (linearClient, stateIds, label) =>
  getIssues(linearClient, stateIds, label, BUG_LABELS);

const getChores = async (linearClient, stateIds, label) =>
  getIssues(linearClient, stateIds, label, CHORE_LABELS);

const getFeatures = async (linearClient, stateIds, label) =>
  getIssues(linearClient, stateIds, label, FEATURE_LABELS);

const getProjects = async (linearClient, stateIds, label) => {
  const issues = await linearClient.issues({
    filter: {
      project: { null: false },
      state: { id: { in: stateIds } },
      labels: label ? { name: { eq: label } } : {},
    },
  });

  const projects = {};

  const projectPromises = issues.nodes.map(async (issue) => {
    if (!(issue._project.id in projects)) {
      projects[issue._project.id] = await issue.project;
    }
  });

  await Promise.all(projectPromises);

  return Object.values(projects).sort(
    (first, second) => second.progress - first.progress,
  );
};

const escapeText = (text) =>
  text.replace(ESPACE_REGEX, (match) => ESCAPE[match]);

const formatProgress = (progress) =>
  progress === 1 ? "Completed" : `${(progress * 100).toFixed()}%`;

const formatTargetDate = (targetDate) =>
  targetDate ? `${new Date(targetDate).toLocaleDateString("de-DE")}` : "/";

const formatIssues = (issues, { showAge } = {}) =>
  issues.nodes
    .map(({ title, url, startedAt, _assignee }) => {
      const user = assignees[_assignee?.id];
      if (showAge && startedAt) {
        if (user) {
          return `- <${url}|${escapeText(title)}> (Started ${daysAgo(startedAt)}d ago by ${user})`
        } else {
          return `- <${url}|${escapeText(title)}> (Started ${daysAgo(startedAt)}d ago)`
        }
      }
      if (user) {
        return `- <${url}|${escapeText(title)}> (:clap::skin-tone-4: ${user})`
      }
      return `- <${url}|${escapeText(title)}>`
    })
    .join("\n") || "_No tickets_";

const formatProjects = (projects) =>
  projects
    .map(({ name, url, progress, targetDate }) => {
      name = `<${url}|${escapeText(name)}>`;
      progress = formatProgress(progress);
      targetDate = formatTargetDate(targetDate);
      return `- ${name}, Progress: ${progress}, Target stage release date: ${targetDate}`;
    })
    .join("\n") || "_No projects_";

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
    const features = await getFeatures(linearClient, stateIds, label);
    const other = await getOther(linearClient, stateIds, label);
    const projects = await getProjects(linearClient, stateIds, label);
    const inProgress = await getInProgressIssues(linearClient, stateIds);

    core.setOutput("has-issues", hasIssues(bugs, chores, features, other));

    const releaseNotes = `
:ship: *Features*
${formatIssues(features)}

:bug: *Bugfixes*
${formatIssues(bugs)}

:broom: *Chores*
${formatIssues(chores)}

:question: *Unlabelled*
${formatIssues(other)}

:construction: *In progress*
${formatIssues(inProgress, { showAge: true })}

:dart: *Projects*
${formatProjects(projects)}
  `;

    core.setOutput("release-notes", releaseNotes);
  } catch (error) {
    core.setFailed(error.message);
  }
};

run();
