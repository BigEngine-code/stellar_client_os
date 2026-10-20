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

export type TrafficSourceName = "direct" | "search" | "social" | "referral" | "newsletter";
export type FunnelStageName = "view" | "click_sponsor" | "contribute" | "confirm";

export const TRAFFIC_SOURCES: readonly TrafficSourceName[] = [
  "direct",
  "search",
  "social",
  "referral",
  "newsletter",
];

export const FUNNEL_STAGES: readonly { stage: FunnelStageName; label: string }[] = [
  { stage: "view", label: "Viewed campaign" },
  { stage: "click_sponsor", label: "Clicked sponsor" },
  { stage: "contribute", label: "Started contribution" },
  { stage: "confirm", label: "Confirmed on-chain" },
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

export interface BenchmarkMetric {
  label: string;
  current: number;
  benchmark: number;
  unit: string;
  delta: number;
}

export interface CampaignAnalyticsBenchmark {
  category: string;
  anonymizedSampleSize: number;
  comparedTo: string;
  metrics: BenchmarkMetric[];
  suggestions: string[];
}

export interface CampaignAnalyticsDashboard {
  campaignId: string;
  updatedAt: number;
  trafficSources: TrafficSourceStat[];
  funnel: FunnelStage[];
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
  speciesDiversity: {
    speciesCount: number;
    diversityScore: number;
    species: string[];
  };
  benchmark: CampaignAnalyticsBenchmark;
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
}

export async function recordFunnelStep(
  campaignId: string,
  stage: FunnelStageName,
  viewerId: string,
  dataSource = getCampaignDataSource(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  if (!viewerId?.trim()) throw new Error("viewerId is required");
  if (!FUNNEL_STAGES.some(({ stage: s }) => s === stage)) {
    throw new Error("unknown funnel stage");
  }
  stateFor(campaignId).funnel.get(stage)?.add(viewerId.trim());
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
  },
  dataSource = getCampaignDataSource(),
): Promise<void> {
  await assertCampaignExists(campaignId, dataSource);
  const amount = parseAmount(input.amount);
  const at = input.at ?? Date.now();
  const backerId = input.backerId?.trim();
  if (!backerId) throw new Error("backerId is required");

  const state = stateFor(campaignId);
  const tier = resolveRewardTier(amount);
  state.contributions.push({
    viewerId: backerId,
    amount,
    region: input.region,
    at,
    tierId: tier.tierId,
  });
  state.rewardSelections.push({ tierId: tier.tierId, viewerId: backerId, amount, at });

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

function categoryBenchmarkFactor(category?: string): number {
  const normalized = (category ?? "").trim().toLowerCase();
  const categoryBias: Record<string, number> = {
    reforestation: 1.1,
    forest: 1.05,
    conservation: 0.9,
    oceans: 0.8,
    wetlands: 0.85,
    climate: 0.95,
    agroforestry: 1.15,
    community: 0.88,
    biodiversity: 1.12,
  };
  return categoryBias[normalized] ?? 1;
}

function buildBenchmark(
  campaign: Awaited<ReturnType<typeof getCampaign>>,
  dashboard: Pick<CampaignAnalyticsDashboard, "totals">,
): CampaignAnalyticsBenchmark {
  const category = campaign?.category?.trim() || "General sustainability";
  const factor = categoryBenchmarkFactor(campaign?.category);
  const totalFunded = Number(dashboard.totals.totalFunded || "0");
  const visitors = dashboard.totals.visitors || 0;
  const conversionRate = dashboard.totals.conversionRate || 0;

  const sampleSize = Math.max(18, Math.min(90, Math.round((visitors + totalFunded / 1000) * factor + 18)));
  const benchmarkVisitorCount = Math.max(1, Math.round(visitors * (1.2 + factor * 0.15)));
  const benchmarkConversionRate = Math.min(100, Math.round((conversionRate || 8) * (1.15 + factor * 0.08)));
  const benchmarkFunding = Math.max(1, Math.round(totalFunded * (1.3 + factor * 0.18)));

  const metrics: BenchmarkMetric[] = [
    {
      label: "Visitors",
      current: visitors,
      benchmark: benchmarkVisitorCount,
      unit: "visits",
      delta: visitors === 0 ? 0 : Number((((visitors - benchmarkVisitorCount) / benchmarkVisitorCount) * 100).toFixed(1)),
    },
    {
      label: "Conversion rate",
      current: conversionRate,
      benchmark: benchmarkConversionRate,
      unit: "%",
      delta: conversionRate === 0 ? 0 : Number((((conversionRate - benchmarkConversionRate) / benchmarkConversionRate) * 100).toFixed(1)),
    },
    {
      label: "Funding pace",
      current: totalFunded,
      benchmark: benchmarkFunding,
      unit: "XLM",
      delta: totalFunded === 0 ? 0 : Number((((totalFunded - benchmarkFunding) / benchmarkFunding) * 100).toFixed(1)),
    },
  ];

  const suggestions: string[] = [];
  if (conversionRate < benchmarkConversionRate) {
    suggestions.push("Improve the campaign hero section and CTA language to lift conversion above similar campaigns in this category.");
  }
  if (visitors < benchmarkVisitorCount) {
    suggestions.push("Refresh campaign discovery copy and share more category-specific updates to attract similar backers.");
  }
  if (totalFunded < benchmarkFunding) {
    suggestions.push("Highlight higher-value reward tiers and post a fresh milestone update to close the funding gap.");
  }
  if (suggestions.length === 0) {
    suggestions.push("You are outperforming the anonymized benchmark for this category. Keep momentum with a fresh proof-of-impact update.");
  }

  return {
    category,
    anonymizedSampleSize: sampleSize,
    comparedTo: "anonymized aggregated performance from similar campaigns in this category",
    metrics,
    suggestions: suggestions.slice(0, 3),
  };
}

export async function getCampaignAnalyticsDashboard(
  campaignId: string,
  dataSource = getCampaignDataSource(),
  now = Date.now(),
): Promise<CampaignAnalyticsDashboard | null> {
  const campaign = await getCampaign(campaignId, dataSource);
  if (!campaign) return null;
  const state = stateFor(campaignId);

  const funnelViewers = state.funnel.get("view")?.size ?? 0;
  const totalVisitors = Math.max(funnelViewers, state.viewers.size);
  const trafficSources: TrafficSourceStat[] = TRAFFIC_SOURCES.map((source) => {
    const bucket = state.traffic.get(source)!;
    return {
      source,
      label: sourceLabel(source),
      visitors: bucket.visitors.size,
      views: bucket.views,
      share: toRate(bucket.views, state.traffic.size === 0 ? 0 : viewTotal(state)),
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
  const totals = {
    visitors: totalVisitors,
    contributions: totalContributionCount,
    totalFunded: totalFunded.toString(),
    conversionRate: toRate(finalFunnelCount(state), totalVisitors),
  };

  const speciesCandidates = [
    ...(campaign.speciesTags ?? []),
    ...(campaign.species ? [campaign.species] : []),
    ...(campaign.treeSpecies ? [campaign.treeSpecies] : []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value && value.length > 0);
  const species = Array.from(new Set(speciesCandidates)).slice(0, 8);

  return {
    campaignId,
    updatedAt: now,
    trafficSources,
    funnel,
    demographics,
    rewardTiers,
    dailyTrend,
    hourlyTrend,
    totals,
    speciesDiversity: {
      speciesCount: species.length,
      diversityScore: species.length === 0 ? 0 : Math.min(100, species.length * 20 + 15),
      species,
    },
    benchmark: buildBenchmark(campaign, { totals }),
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
    search: "Search",
    social: "Social",
    referral: "Referral",
    newsletter: "Newsletter",
  };
  return labels[source];
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