import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { graphql as __graphql } from '@octokit/graphql';

const getCachePath = (queryName: string) => resolve(__dirname, './.cache/', `${queryName}.json`);

const twoHours = 1000 * 60 * 60 * 2;

const tryLoadCachedResults = async (queryName: string) => {
  try {
    const result = await readFile(getCachePath(queryName));
    const cache = JSON.parse(result.toString());
    const cacheAge = Date.now() - cache.cacheTime;
    const isCacheOld = cache?.cacheTime && cacheAge > twoHours;
    console.log(`Cache loaded, age: ${cacheAge}, isCacheOld: ${isCacheOld}`);
    if (isCacheOld) {
      return false;
    }
    return cache.results;
  } catch (e) {
    console.log(`unable to load cache for '${queryName}': ${e}`);
    return false;
  }
};

const tryCacheQueryResults = async (queryName: string, results?: Record<string, any>) => {
  if (!results) {
    return;
  }

  try {
    await mkdir(resolve(__dirname, './.cache/'));
  } catch (e) {
    // ignore, dir likely exists
  }
  await writeFile(getCachePath(queryName), JSON.stringify({ cacheTime: Date.now(), results }));
};

const formatDate = (date: Date) => {
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
};

/**
 * For some reason Date instances aren't coerced to graphql DateTime
 * @param date
 * @returns
 */
const formatDateTime = (date: Date) => {
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const mins = date.getUTCMinutes().toString().padStart(2, '0');
  const ms = date.getUTCMilliseconds().toString().padStart(2, '0');
  const time = `${hours}:${mins}:${ms}Z`; // todo: pull time from date?
  return `${formatDate(date)}T${time}`;
};

const graphql = (query: string, variables?: Record<string, any>) =>
  __graphql(query, {
    baseUrl: 'https://github.docusignhq.com/api',
    ...variables,
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`
    }
  });

type queryFn = (after: undefined | string) => string;
type PageInfo = { hasNextPage: boolean; endCursor?: string };
type MapResultsFn<TResult, TData> = (results: unknown) => { list: TResult[]; data: TData; pageInfo: PageInfo };

export async function getAllResultsFromQuery<TResult, TData>(
  query: queryFn,
  mapResults: MapResultsFn<TResult, TData>,
  variables: Record<string, any> = {}
) {
  let results: TResult[] = [];
  let data: TData = {} as unknown as TData;
  let hasNextPage = true;
  let endCursor: string | undefined;
  while (hasNextPage) {
    console.log('querying with endCursor', endCursor);
    const queryStr = query(endCursor);
    // console.log(queryStr);
    // eslint-disable-next-line no-await-in-loop
    const result = mapResults(await graphql(queryStr, variables));

    console.log(
      'querying with endCursor',
      // result.data.issueCount,
      result.pageInfo?.hasNextPage,
      result.pageInfo?.endCursor
    );

    ({ hasNextPage, endCursor } = result.pageInfo);
    results = results.concat(result.list);
    data = { ...data, ...result.data };

    if (!hasNextPage) {
      return { data, results };
    }
  }
}

const mapSearchQueryResults = (results) => {
  const { pageInfo, nodes: list, ...data } = results.search;
  return { pageInfo, list, data };
};

// query: 'is:pr is:merged closed:${formatDate(startDate)}..${formatDate(endDate)}',
const createSearchQuery = (searchQuery: string, fields: string) => (after?: string) =>
  `
query {
  search(
    first: 100,
    type: ISSUE,
    ${after ? `after: "${after}",` : ''}
		query: "${searchQuery}"
    ) {
		  pageInfo{ endCursor, hasNextPage }
      issueCount,
      ${fields}
    }
  }
`;

interface PRsAuthoredByUserVariables {
  user: string;
  startDate: Date;
  endDate: Date;
  after?: string;
}

export const getPRsAuthoredByUser = (variables: PRsAuthoredByUserVariables) => {
  const queryStr = `author:${variables.user} is:pr is:merged closed:${formatDate(variables.startDate)}..${formatDate(
    variables.endDate
  )}`;
  const fields = ` nodes {
    ... on PullRequest {
      id
      title
      url,
      state,
      closed,
      merged,
      closedAt,
      mergedAt
    }
  }`;
  const queryFactory = createSearchQuery(queryStr, fields);

  return getAllResultsFromQuery(queryFactory, mapSearchQueryResults);
};

export const getPRCountAuthoredByUser = async (variables: PRsAuthoredByUserVariables) => {
  const queryStr = `author:${variables.user} is:pr is:merged closed:${formatDate(variables.startDate)}..${formatDate(
    variables.endDate
  )}`;
  const queryFactory = createSearchQuery(queryStr, '');

  return ((await graphql(queryFactory(undefined))) as any).search.issueCount as number;
};

export const getPRCountAuthoredByUser2 = async (variables: PRsAuthoredByUserVariables) => {
  const query = `query ContributionsView($username: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $username) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
  }
  `;

  const mappedVariables = {
    username: variables.user,
    from: variables.startDate,
    to: variables.endDate
  };
  return (await graphql(query, mappedVariables)) as any;
};

export const getAllMergedPRsInDate = async (startDate: Date, endDate: Date) => {
  const queryFactory = createSearchQuery(
    `is:pr is:merged closed:${formatDate(startDate)}..${formatDate(endDate)}`,
    `nodes {
      ... on PullRequest { author { login }}
    }`
  );

  const results = await getAllResultsFromQuery(queryFactory, mapSearchQueryResults);
  return results;
};

// TODO: Do we need this?
export const getUserPRs = () => `query getContributionsForUser($user: String) {
	user(login: $user) {
    pullRequests {
      totalCount
    }
    contributionsCollection {
      pullRequestContributions {totalCount}
      pullRequestReviewContributionsByRepository {
        contributions {
          totalCount
        }
        repository {
          name
        }
      }
    }
  }
}`;

const getAllUsersInEnterpriseQuery = (enterpriseSlug: string) => (after?: string) =>
  `query getAllUsers {
	enterprise(slug: "${enterpriseSlug}") {
		members(
      first: 100
      ${after ? `,after: "${after}"` : ''}
    ) {
			totalCount,
		  pageInfo{ endCursor, hasNextPage }
			nodes {
				... on User {login}
			}
		}
	}
}`;
type getAllUsersInEnterpriseResult = {
  login: string;
};
const mapGetAllUsersResults: MapResultsFn<getAllUsersInEnterpriseResult, { totalCount: number }> = (results) => {
  const { pageInfo, nodes: list, ...data } = (results as any).enterprise.members;
  return { pageInfo, list, data };
};

export const getAllUsers = async (startDate: Date, endDate: Date) => {
  const queryFactory = getAllUsersInEnterpriseQuery('docusign-inc');
  const results = await getAllResultsFromQuery(queryFactory, mapGetAllUsersResults);
  return results;
};

export type UserContributionsResult = {
  contributionsCollection: {
    totalCommitContributions: number;
    totalIssueContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalRepositoriesWithContributedCommits: number;
    totalRepositoriesWithContributedPullRequests: number;
    totalRepositoriesWithContributedPullRequestReviews: number;
  };
  createdAt: string;
  login: string;
};
export type GetAllUserContributionsResult = {
  data: { totalCount: number };
  results: UserContributionsResult[];
};

export const getAllUserContributions = async (
  startDate: Date,
  endDate: Date
): Promise<GetAllUserContributionsResult> => {
  const queryName = 'getAllUserContributions';
  const result = await tryLoadCachedResults(queryName);
  if (result) {
    return result;
  }
  const variables = { from: formatDateTime(startDate), to: formatDateTime(endDate) };
  console.log(variables);
  const queryFactory = (after?: string) => `
  query getAllUserContributions( $from: DateTime!, $to: DateTime!) {
    enterprise(slug: "docusign-inc") {
      members(
        first: 100
        ${after ? `,after: "${after}"` : ''}
      ) {
        totalCount,
        pageInfo{ endCursor, hasNextPage }
        nodes {
          ... on User {
             login,
            createdAt
              contributionsCollection(from: $from, to: $to) {

                  totalCommitContributions
                  totalIssueContributions
                  totalPullRequestContributions
                  totalPullRequestReviewContributions

                  # Number of repositories contributed to
                  totalRepositoriesWithContributedCommits
                  totalRepositoriesWithContributedPullRequests
                  totalRepositoriesWithContributedPullRequestReviews
                }
          }
        }
      }
    }
  }`;

  const results = await getAllResultsFromQuery(queryFactory, mapGetAllUsersResults, variables);
  await tryCacheQueryResults(queryName, results);
  return results;
};
