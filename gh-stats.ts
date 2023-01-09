import { Stats } from 'fast-stats';
import PromiseQueue from '../src/js/reactApp/utilities/PromiseQueue';
import {
  getAllUserContributions,
  GetAllUserContributionsResult,
  getAllUsers,
  getPRCountAuthoredByUser,
  getPRCountAuthoredByUser2,
  UserContributionsResult
} from './ghStats.queries';

process.env.GH_TOKEN = "" // TODO: create a GH Token with all read perms and put it here

if (!process.env.GH_TOKEN) {
  throw new Error("Please create a GH Token and put it in the process.env.GH_TOKEN lin in gh-stats.ts")
}

type StatType = keyof UserContributionsResult['contributionsCollection'];
const user = 'nick-bolles';
const requestQueue = new PromiseQueue<{ username: string; count: number }>({ concurrentLimit: 2 });

// Returns the percentile of the given value in a sorted numeric array.
function percentRank(arr: number[], v: number) {
  if (typeof v !== 'number') throw new TypeError('v must be a number');
  for (let i = 0, l = arr.length; i < l; i++) {
    if (v <= arr[i]) {
      while (i < l && v === arr[i]) i++;
      if (i === 0) return 0;
      if (v !== arr[i - 1]) {
        i += (v - arr[i - 1]) / (arr[i] - arr[i - 1]);
      }
      return i / l;
    }
  }
  return 1;
}

const getMyPRCount = async (startDate: Date, endDate: Date) => {
  const allPRsByMe = await getPRCountAuthoredByUser2({ startDate, endDate, user });
  console.log(allPRsByMe);
};

const getAllUserContribStats = async (startDate: Date, endDate: Date) => {
  console.log('Getting list of users...');
  const users = await getAllUsers(startDate, endDate);
  console.log('All Users: ', users?.data.totalCount, users?.results.length);

  if (!users) {
    console.error('Users is empty, quitting early');
    return false;
  }
  console.log(` - Found ${users?.results.length} users`);
  console.log('Getting PR count for each user...');

  const promises = users.results.map((user) => {
    const queueEntry = requestQueue.enqueue(async () => {
      await delay(250); // Wait a bit between users to avoid bombarding th server and triggering throttling
      const result = await getPRCountAuthoredByUser({ startDate, endDate, user: user.login });
      return { username: user.login, count: result };
    });
    return queueEntry;
  });

  const results = await Promise.all(promises);

  // Gather some stats from the array
  const stats = results.reduce(
    (stats, v) => {
      if (v.username.length > stats.longestIdLength) stats.longestIdLength = v.username.length;
      return stats;
    },
    { longestIdLength: 0 }
  );

  // Sort the results
  const sorted = results.sort((a, b) => a.count - b.count);

  const strResult = sorted.map((v) => `${`${v.username}: `.padEnd(stats.longestIdLength)}${v.count}`).join('\n');
  console.log(strResult);
};
const contributionHasNoValue = (result: UserContributionsResult) =>
  Object.entries(result.contributionsCollection).every(([key, value]) => parseInt(value, 10) === 0);

const printUserContributionsStat = (
  queryResult: GetAllUserContributionsResult,
  statsToPrint: StatType[] = [
    'totalCommitContributions',
    'totalPullRequestReviewContributions',
    'totalPullRequestContributions'
  ],
  userToBenchmark: string
) => {
  const filteredResults = queryResult.results.filter((v) => !contributionHasNoValue(v));
  console.log(
    `Filtered out ${queryResult.results.length - filteredResults.length} users with no contributions of any kind`
  );

  // Gather some stats from the array
  const stats = filteredResults.reduce(
    (stats, v) => {
      if (v.login.length > stats.longestIdLength) stats.longestIdLength = v.login.length;
      if (contributionHasNoValue(v)) {
        stats.usersWithZeroContributions++;
      }
      for (const [key, value] of Object.entries(v.contributionsCollection)) {
        stats.contributionsCollectionStats[key].push(parseInt(value, 10));
      }
      stats.userMap[v.login] = v;
      return stats;
    },
    {
      longestIdLength: 0,
      usersWithZeroContributions: 0,
      usersWithoutThisStat: 0,
      contributionsCollectionStats: {
        totalCommitContributions: new Stats(),
        totalIssueContributions: new Stats(),
        totalPullRequestContributions: new Stats(),
        totalPullRequestReviewContributions: new Stats(),
        totalRepositoriesWithContributedCommits: new Stats(),
        totalRepositoriesWithContributedPullRequests: new Stats(),
        totalRepositoriesWithContributedPullRequestReviews: new Stats()
      },
      userMap: {}
    }
  );

  // Sort the results
  const statStats: Record<StatType, { ranked: UserContributionsResult[] }> = {} as any;
  for (const [stat] of Object.entries(filteredResults[0].contributionsCollection)) {
    statStats[stat] = {};

    statStats[stat].ranked = Array.from(filteredResults).sort((a, b) => {
      const valB = parseInt(b.contributionsCollection[stat], 10);
      const valA = parseInt(a.contributionsCollection[stat], 10);
      return valB - valA;
    });
  }
  const sorted = statStats[statsToPrint[0]].ranked;

  const getRank = (stat: StatType, value: number) =>
    statStats[stat].ranked.findIndex((v) => v.contributionsCollection[stat] === value) + 1;
  const getCount = (stat: StatType) => statStats[stat].ranked.filter(Boolean).length;
  const getPercentile = (stat: StatType, value: number) => {
    const countAbove = getRank(stat, value);
    const { length } = statStats[stat].ranked;
    return Math.round((countAbove / length) * 100);
  };

  const getStatSummary = (user: string, stat: StatType) => {
    const value = stats.userMap[user].contributionsCollection[stat];
    const rank = getRank(stat, value);

    const percentile = getPercentile(stat, value);
    return `(#${rank}/${getCount(stat)} - %${percentile})`.padStart(15) + `${value}`.padStart(5);
  };

  const printUserStats = (user: string, statsToPrint: StatType[], headers: string[]) =>
    statsToPrint
      // Get the stat summary and make sure that the width matches the header
      .map((statToPrint, i) => getStatSummary(user, statToPrint).padEnd(headers[i].length))
      .join('');

  const statsHeaders = statsToPrint.map((statToPrint) => `${statToPrint}`.padEnd(30));
  const firstRow = [`Name`.padEnd(stats.longestIdLength + 3), ...statsHeaders];

  const rows = sorted
    .map(
      (v, i) =>
        `${`${v.login}: `.padEnd(stats.longestIdLength + 3)}${printUserStats(v.login, statsToPrint, statsHeaders)}`
    )
    .join('\n');
  const strResult = `${firstRow.join(' ')}\n${rows}`;

  console.log(strResult);

  if (userToBenchmark) {
    const userStats = stats.userMap[userToBenchmark];
    if (!userStats) {
      console.log(`Unable to find stats for user ${userToBenchmark}`);
      return;
    }
    console.log(`Benchmarks for user ${userToBenchmark}`);
    for (const [stat] of Object.entries(userStats.contributionsCollection)) {
      if (statsToPrint.includes(stat)) {
        console.log(`\t${stat}: `, getStatSummary(userToBenchmark, stat));
      }
    }
  }
};

const getAllUserContribStats2 = async (startDate: Date, endDate: Date) => {
  const results = await getAllUserContributions(startDate, endDate);

  await printUserContributionsStat(results, undefined, user);
};

async function main() {
  const startDate = new Date('2022-01-01T00:00:00Z');
  const endDate = new Date('2023-01-01T00:00:00Z');
  // await getMyPRCount(startDate, endDate);
  // await getAllUserContribStats(startDate, endDate);
  await getAllUserContribStats2(startDate, endDate);
}

void main();
