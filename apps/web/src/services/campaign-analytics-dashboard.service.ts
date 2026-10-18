/**
 * Campaign Analytics Dashboard Service
 *
 * Detailed creator metrics for a single campaign:
 *
 *   - traffic sources      : where visitors arrive from
 *   - conversion funnel    : view -> click sponsor -> contribute -> confirm
 *   - backer demographics  : geographic distribution of backers
 *   - reward tier popularity: which reward levels backers choose
 *   - daily funding trends : daily contributions and cumulative funding
 *
 * This extends the vertex-level `campaign-analytics.service` (page views,
 * contributions, refunds) with an aggregated dashboard view suitable for a
 * creator analytics screen.
 */

import {
  getCampaign,
  getCampaignDataSource,
  type CampaignDataSource,
} from "./campaign.service";

export type TrafficSourceName =
  | "direct"
  | "social"
  | "email"
  | "search"
  | "referral"
  | "newsletter";

export type FunnelStageName =
  | "view"
  | "visitors"
  | "click_sponsor"
  | "contribute"
  | "pledge_initiated"
  | "confirm"
  | "pledge_completed";

export const TRAFFIC_SOURCES: readonly TrafficSourceName[] = [
  "direct",
  "social",
  "email",
  "search",
  "referral",
  "newsletter",
];

export const FUNNEL_STAGES: readonly { stage: FunnelStageName; label: string }[] = [
  { stage: "view", label: "Viewed campaign" },
  { stage: "click_sponsor", label: "Clicked sponsor" },
  { stage: "contribute", label: "Started contribution" },
  { stage: "confirm", label: "Confirmed on-chain" },
];

export const PLEDGE_FUNNEL_STAGES: readonly {
  stage: "visitors" | "pledge_initiated" | "pledge_completed";
  label: string;
}[] = [
  { stage: "visitors", label: "Visitors" },
  { stage: "pledge_initiated", label: "Pledge initiated" },
  { stage: "pledge_completed", label: "Pledge completed" },
];

export interface RewardTierDefinition {
  tierId: string;
  name: string;
  price: string;
}

export const DEFAULT_REWARD_TIERS: readonly RewardTierDefinition[] = [
  { tierId: "TIER_1", name: "Starter Supporter", price: "100" },
  { tierId: "TIER_2", name: "Field Impactor", price: "250" },
  { tierId: "TIER_3", name: "Advocate", price: "500" },
  { tierId: "TIER_4", name: "Patron", price: "1000" },
  { tierId: "TIER_5", name: "Legendary Guardian", price: "5000" },
];

export interface TrafficSourceStat {
  source: TrafficSourceName;
  label: string;
  visitors: number;
  views: number;
  share: number;
  pledges: number;
  /** Visit-to-pledge conversion rate as a percentage (0–100). */
  conversionRate: number;
}

export interface FunnelStage {
  stage: FunnelStageName;
  label: string;
  count: number;
  /** Percentage of the FIRST funnel stage that reached this stage (0–100). */
  conversionRate: number;
  /** Percentage drop-off from the previous stage (positive = people left). */
  dropoffRate: number;
}

export interface PledgeFunnelStage {
  stage: "visitors" | "pledge_initiated" | "pledge_completed";
  label: string;
  count: number;
  /** Percentage of initial visitors that reached this stage (0–100). */
  conversionRate: number;
  /** Percentage drop-off from the previous stage (positive = people left). */
  dropoffRate: number;
}

export interface BackerDemographic {
  region: string;
  backers: number;
  totalAmount: string;
  share: number;
}

export interface RewardTierStat {
  tierId: string;
  name: string;
  price: string;
  backers: number;
  revenue: string;
  share: number;
}

export interface DailyFundingPoint {
  /** ISO date (YYYY-MM-DD) in UTC. */
  date: string;
  amount: string;
  contributions: number;
  cumulative: string;
}

export interface HourlyFundingPoint {
  /** ISO date-hour (YYYY-MM-DDTHH:00) in UTC. */
  hour: string;
  amount: string;
  contributions: number;
  cumulative: string;
}

export interface CampaignAnalyticsDashboard {
  campaignId: string;
  updatedAt: number;
  trafficSources: TrafficSourceStat[];
  funnel: FunnelStage[];
  pledgeFunnel?: PledgeFunnelStage[];
  demographics: BackerDemographic[];
  rewardTiers: RewardTierStat[];
  dailyTrend: DailyFundingPoint[];
  hourlyTrend: HourlyFundingPoint[];
  totals: {
    visitors: number;
    contributions: number;
    totalFunded: string;
    conversionRate: number;
  };
  sustainability?: unknown;
}

interface DashboardState {
  traffic: Map<TrafficSourceName, { visitors: Set<string>; views: number }>;
  funnel: Map<FunnelStageName, Set<string>>;
  demographics: Map<string, { viewers: Set<string>; totalAmount: bigint }>;
  rewardSelections: Array<{ tierId: string; viewerId: string; amount: bigint; at: number }>;
  daily: Map<string, { contributions: number; amount: bigint }>;
  viewers: Map<string, { source: TrafficSourceName; firstSeen: number; region?: string }>;
  contributions: Array<{ viewerId: string; amount: bigint; region?: string; at: number; tierId: string }>;
}

const states = new Map<string, DashboardState>();

function stateFor(campaignId: string): DashboardState {
  let state = states.get(campaignId);
  if (!state) {
    state = {
      traffic: new Map(),
      funnel: new Map(),
      demographics: new Map(),
      rewardSelections: [],
      daily: new Map(),
      viewers: new Map(),
      contributions: [],
    };
    TRAFFIC_SOURCES.forEach((source) => state.traffic.set(source, { visitors: new Set(), views: 0 }));
    FUNNEL_STAGES.forEach(({ stage }) => state.funnel.set(stage, new Set()));
    PLEDGE_FUNNEL_STAGES.forEach(({ stage }) => state.funnel.set(stage, new Set()));
    states.set(campaignId, state);
  }
  return state;
}

function parseAmount(amount: string): bigint {
  if (!/^\d+$/.test(amount)) throw new Error("amount must be a non-negative integer string");
  return BigInt(amount);
}

function toDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function toRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 10;
}

async function assertCampaignExists(
  campaignId: string,
  dataSource: CampaignDataSource,
): Promise<void> {
  if (!(await getCampaign(campaignId, dataSource))) throw new Error("Campaign not found");
}

export async function recordTrafficSource(
  campaignId: string,
  source: TrafficSourceName,
  viewerId?: string,
  dataSource = getCampaignDataSource(),
  at = Date.now(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  if (!TRAFFIC_SOURCES.includes(source)) throw new Error(`source must be one of ${TRAFFIC_SOURCES.join(", ")}`);
  const id = viewerId?.trim() || `anonymous:${crypto.randomUUID()}`;
  const state = stateFor(campaignId);
  const bucket = state.traffic.get(source)!;
  bucket.views += 1;
  bucket.visitors.add(id);
  const existing = state.viewers.get(id);
  if (!existing) state.viewers.set(id, { source, firstSeen: at });
  state.funnel.get("view")?.add(id);
  state.funnel.get("visitors")?.add(id);
}

export async function recordFunnelStep(
  campaignId: string,
  stage: FunnelStageName,
  viewerId: string,
  dataSource = getCampaignDataSource(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  if (!viewerId?.trim()) throw new Error("viewerId is required");
  const trimmed = viewerId.trim();
  const state = stateFor(campaignId);
  if (stage === "view" || stage === "visitors") {
    state.funnel.get("view")?.add(trimmed);
    state.funnel.get("visitors")?.add(trimmed);
  } else if (stage === "contribute" || stage === "pledge_initiated") {
    state.funnel.get("contribute")?.add(trimmed);
    state.funnel.get("pledge_initiated")?.add(trimmed);
  } else if (stage === "confirm" || stage === "pledge_completed") {
    state.funnel.get("confirm")?.add(trimmed);
    state.funnel.get("pledge_completed")?.add(trimmed);
  } else if (stage === "click_sponsor") {
    state.funnel.get("click_sponsor")?.add(trimmed);
  } else {
    throw new Error("unknown funnel stage");
  }
}

export async function recordBackerDemographic(
  campaignId: string,
  backerId: string,
  region: string,
  amount: string,
  dataSource = getCampaignDataSource(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  if (!backerId?.trim() || !region?.trim()) throw new Error("backerId and region are required");
  const state = stateFor(campaignId);
  const bucket = state.demographics.get(region) ?? { viewers: new Set<string>(), totalAmount: 0n };
  bucket.viewers.add(backerId.trim());
  bucket.totalAmount += parseAmount(amount);
  state.demographics.set(region, bucket);
}

export async function recordBackerContribution(
  campaignId: string,
  input: {
    amount: string;
    backerId: string;
    region?: string;
    at?: number;
    source?: TrafficSourceName;
  },
  dataSource = getCampaignDataSource(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  const amount = parseAmount(input.amount);
  const at = input.at ?? Date.now();
  const backerId = input.backerId?.trim();
  if (!backerId) throw new Error("backerId is required");

  const state = stateFor(campaignId);
  if (input.source && TRAFFIC_SOURCES.includes(input.source)) {
    const bucket = state.traffic.get(input.source);
    if (bucket) {
      bucket.visitors.add(backerId);
      if (bucket.views === 0) bucket.views = 1;
    }
    if (!state.viewers.has(backerId)) {
      state.viewers.set(backerId, { source: input.source, firstSeen: at });
    }
  } else if (!state.viewers.has(backerId)) {
    state.viewers.set(backerId, { source: "direct", firstSeen: at });
    const directBucket = state.traffic.get("direct");
    if (directBucket) {
      directBucket.visitors.add(backerId);
      if (directBucket.views === 0) directBucket.views = 1;
    }
  }

  const tier = resolveRewardTier(amount);
  state.contributions.push({
    viewerId: backerId,
    amount,
    region: input.region,
    at,
    tierId: tier.tierId,
  });
  state.rewardSelections.push({ tierId: tier.tierId, viewerId: backerId, amount, at });

  // Pledging covers both initiation and completion
  state.funnel.get("view")?.add(backerId);
  state.funnel.get("visitors")?.add(backerId);
  state.funnel.get("contribute")?.add(backerId);
  state.funnel.get("pledge_initiated")?.add(backerId);
  state.funnel.get("confirm")?.add(backerId);
  state.funnel.get("pledge_completed")?.add(backerId);

  const day = toDateKey(at);
  const bucket = state.daily.get(day) ?? { contributions: 0, amount: 0n };
  bucket.contributions += 1;
  bucket.amount += amount;
  state.daily.set(day, bucket);

  if (input.region) await recordBackerDemographic(campaignId, backerId, input.region, input.amount, dataSource);
}

export function resolveRewardTier(amount: bigint): RewardTierDefinition {
  let selected = DEFAULT_REWARD_TIERS[0];
  for (const tier of DEFAULT_REWARD_TIERS) {
    if (amount >= parseAmount(tier.price)) selected = tier;
  }
  return selected;
}

export function clearCampaignAnalyticsDashboard(campaignId: string): void {
  states.delete(campaignId);
}

function sumBigInt(values: bigint[]): bigint {
  return values.reduce((sum, value) => sum + value, 0n);
}

export async function getCampaignAnalyticsDashboard(
  campaignId: string,
  dataSource = getCampaignDataSource(),
  now = Date.now(),
): Promise<CampaignAnalyticsDashboard | null> {
  const campaign = await getCampaign(campaignId, dataSource);
  if (!campaign) return null;
  const state = stateFor(campaignId);

  // Identify all unique backers who completed a pledge
  const pledgerIds = new Set<string>();
  for (const contribution of state.contributions) {
    pledgerIds.add(contribution.viewerId);
  }
  const confirmed = state.funnel.get("confirm");
  if (confirmed) {
    for (const id of confirmed) pledgerIds.add(id);
  }
  const completed = state.funnel.get("pledge_completed");
  if (completed) {
    for (const id of completed) pledgerIds.add(id);
  }

  // Count pledges broken down by traffic source
  const pledgesBySource = new Map<TrafficSourceName, number>();
  for (const source of TRAFFIC_SOURCES) {
    pledgesBySource.set(source, 0);
  }
  for (const pledgerId of pledgerIds) {
    const viewer = state.viewers.get(pledgerId);
    const source: TrafficSourceName =
      viewer?.source && TRAFFIC_SOURCES.includes(viewer.source)
        ? viewer.source
        : "direct";
    pledgesBySource.set(source, (pledgesBySource.get(source) ?? 0) + 1);
  }

  const funnelViewers = Math.max(
    state.funnel.get("view")?.size ?? 0,
    state.funnel.get("visitors")?.size ?? 0,
  );
  const totalVisitors = Math.max(funnelViewers, state.viewers.size);

  const trafficSources: TrafficSourceStat[] = TRAFFIC_SOURCES.map((source) => {
    const bucket = state.traffic.get(source)!;
    const pledges = pledgesBySource.get(source) ?? 0;
    const visitors = Math.max(bucket.visitors.size, pledges);
    return {
      source,
      label: sourceLabel(source),
      visitors,
      views: Math.max(bucket.views, visitors),
      share: toRate(bucket.views, state.traffic.size === 0 ? 0 : viewTotal(state)),
      pledges,
      conversionRate: toRate(pledges, visitors),
    };
  }).sort((a, b) => b.views - a.views);

  const funnelEntries = FUNNEL_STAGES.map(({ stage }) => state.funnel.get(stage)!.size);
  const firstStage = funnelEntries[0] ?? 0;
  const funnel: FunnelStage[] = FUNNEL_STAGES.map(({ stage, label }, index) => {
    const count = funnelEntries[index];
    const previous = index === 0 ? firstStage : funnelEntries[index - 1];
    return {
      stage,
      label,
      count,
      conversionRate: toRate(count, firstStage),
      dropoffRate: index === 0 ? 0 : toRate(Math.max(previous - count, 0), previous),
    };
  });

  const funnelVisitors = Math.max(firstStage, totalVisitors);
  const funnelInitiated = Math.max(
    state.funnel.get("contribute")?.size ?? 0,
    state.funnel.get("pledge_initiated")?.size ?? 0,
    pledgerIds.size,
  );
  const funnelCompleted = Math.max(
    state.funnel.get("confirm")?.size ?? 0,
    state.funnel.get("pledge_completed")?.size ?? 0,
    pledgerIds.size,
  );

  const effectiveVisitors = Math.max(funnelVisitors, funnelInitiated, funnelCompleted);
  const effectiveInitiated = Math.max(funnelInitiated, funnelCompleted);
  const effectiveCompleted = funnelCompleted;

  const pledgeFunnel: PledgeFunnelStage[] = [
    {
      stage: "visitors",
      label: "Visitors",
      count: effectiveVisitors,
      conversionRate: 100,
      dropoffRate: 0,
    },
    {
      stage: "pledge_initiated",
      label: "Pledge initiated",
      count: effectiveInitiated,
      conversionRate: toRate(effectiveInitiated, effectiveVisitors),
      dropoffRate: toRate(Math.max(effectiveVisitors - effectiveInitiated, 0), effectiveVisitors),
    },
    {
      stage: "pledge_completed",
      label: "Pledge completed",
      count: effectiveCompleted,
      conversionRate: toRate(effectiveCompleted, effectiveVisitors),
      dropoffRate: toRate(Math.max(effectiveInitiated - effectiveCompleted, 0), effectiveInitiated),
    },
  ];

  const demographicRegions = Array.from(state.demographics.entries());
  const totalDemographicAmount = sumBigInt(demographicRegions.map(([, bucket]) => bucket.totalAmount));
  const demographics: BackerDemographic[] = demographicRegions
    .map(([region, bucket]) => ({
      region,
      backers: bucket.viewers.size,
      totalAmount: bucket.totalAmount.toString(),
      share: toRate(Number(bucket.totalAmount), Number(totalDemographicAmount || 1n)),
    }))
    .sort((a, b) => Number(BigInt(b.totalAmount) - BigInt(a.totalAmount)));

  const tierRevenue = new Map<string, { backers: Set<string>; revenue: bigint }>();
  for (const selection of state.rewardSelections) {
    const bucket = tierRevenue.get(selection.tierId) ?? { backers: new Set<string>(), revenue: 0n };
    bucket.revenue += selection.amount;
    bucket.backers.add(selection.viewerId);
    tierRevenue.set(selection.tierId, bucket);
  }
  const rewardTiers: RewardTierStat[] = DEFAULT_REWARD_TIERS.map((tier) => {
    const bucket = tierRevenue.get(tier.tierId);
    const backers = bucket?.backers.size ?? 0;
    const revenue = bucket?.revenue ?? 0n;
    return {
      tierId: tier.tierId,
      name: tier.name,
      price: tier.price,
      backers,
      revenue: revenue.toString(),
      share: backers === 0 ? 0 : toRate(backers, state.rewardSelections.length),
    };
  }).sort((a, b) => Number(BigInt(b.revenue) - BigInt(a.revenue)));

  const days = Array.from(state.daily.entries()).sort(([a], [b]) => a.localeCompare(b));
  let cumulative = 0n;
  const dailyTrend: DailyFundingPoint[] = days.map(([date, bucket]) => {
    cumulative += bucket.amount;
    return {
      date,
      amount: bucket.amount.toString(),
      contributions: bucket.contributions,
      cumulative: cumulative.toString(),
    };
  });

  const hourlyMap = new Map<string, { contributions: number; amount: bigint }>();
  for (const contribution of state.contributions) {
    const hourKey = new Date(contribution.at).toISOString().slice(0, 13) + ":00";
    const bucket = hourlyMap.get(hourKey) ?? { contributions: 0, amount: 0n };
    bucket.contributions += 1;
    bucket.amount += contribution.amount;
    hourlyMap.set(hourKey, bucket);
  }
  const hours = Array.from(hourlyMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  let hourlyCumulative = 0n;
  const hourlyTrend: HourlyFundingPoint[] = hours.map(([hour, bucket]) => {
    hourlyCumulative += bucket.amount;
    return {
      hour,
      amount: bucket.amount.toString(),
      contributions: bucket.contributions,
      cumulative: hourlyCumulative.toString(),
    };
  });

  const totalContributionCount = state.contributions.length;
  const totalFunded = sumBigInt(state.contributions.map((contribution) => contribution.amount));

  return {
    campaignId,
    updatedAt: now,
    trafficSources,
    funnel,
    pledgeFunnel,
    demographics,
    rewardTiers,
    dailyTrend,
    hourlyTrend,
    totals: {
      visitors: effectiveVisitors,
      contributions: totalContributionCount,
      totalFunded: totalFunded.toString(),
      conversionRate: toRate(effectiveCompleted, effectiveVisitors),
    },
  };
}

function viewTotal(state: DashboardState): number {
  let total = 0;
  state.traffic.forEach((bucket) => {
    total += bucket.views;
  });
  return total;
}

function finalFunnelCount(state: DashboardState): number {
  return state.funnel.get("confirm")?.size ?? 0;
}

function sourceLabel(source: TrafficSourceName): string {
  const labels: Record<TrafficSourceName, string> = {
    direct: "Direct",
    social: "Social",
    email: "Email",
    search: "Search",
    referral: "Referral",
    newsletter: "Newsletter",
  };
  return labels[source] ?? source;
}

export function seedCampaignAnalyticsDashboard(
  campaignId: string,
  seed: Partial<Pick<DashboardState, "contributions" | "traffic" | "funnel">>,
): void {
  const state = stateFor(campaignId);
  if (seed.traffic) {
    seed.traffic.forEach((bucket, source) => {
      state.traffic.set(source, bucket);
    });
  }
  if (seed.funnel) {
    seed.funnel.forEach((set, stage) => {
      state.funnel.set(stage, set);
    });
  }
  if (seed.contributions) {
    seed.contributions.forEach((contribution) => {
      state.contributions.push(contribution);
      const day = toDateKey(contribution.at);
      const bucket = state.daily.get(day) ?? { contributions: 0, amount: 0n };
      bucket.contributions += 1;
      bucket.amount += contribution.amount;
      state.daily.set(day, bucket);
      state.rewardSelections.push({
        tierId: resolveRewardTier(contribution.amount).tierId,
        viewerId: contribution.viewerId,
        amount: contribution.amount,
        at: contribution.at,
      });
    });
  }
}

export type { DashboardState as CampaignAnalyticsDashboardState };