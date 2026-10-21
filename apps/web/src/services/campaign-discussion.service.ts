import { randomUUID } from "node:crypto";

export interface CampaignDiscussionComment {
  id: string;
  campaignId: string;
  parentId: string | null;
  authorName: string;
  authorAddress?: string;
  content: string;
  createdAt: number;
  upvotes: number;
  hasUpvoted: boolean;
  isCreatorReply: boolean;
  officialAnswer: boolean;
  pinned: boolean;
}

interface StoredCampaignDiscussionComment extends Omit<CampaignDiscussionComment, "hasUpvoted"> {
  voterIds: Set<string>;
}

const discussions = new Map<string, StoredCampaignDiscussionComment[]>();

export const DISCUSSION_CONTENT_MAX_LENGTH = 1000;
export const DISCUSSION_AUTHOR_NAME_MAX_LENGTH = 60;

function normalizeAddress(address: string | undefined): string {
  return address?.trim().toLowerCase() ?? "";
}

function findComment(campaignId: string, commentId: string) {
  return (discussions.get(campaignId) ?? []).find((comment) => comment.id === commentId);
}

function toPublicComment(comment: StoredCampaignDiscussionComment, voterId?: string): CampaignDiscussionComment {
  const { voterIds, ...publicComment } = comment;
  return { ...publicComment, hasUpvoted: Boolean(voterId && voterIds.has(voterId)) };
}

function compareComments(left: StoredCampaignDiscussionComment, right: StoredCampaignDiscussionComment): number {
  return Number(right.pinned) - Number(left.pinned)
    || right.upvotes - left.upvotes
    || right.createdAt - left.createdAt;
}

export function listCampaignDiscussionComments(campaignId: string, voterId?: string): CampaignDiscussionComment[] {
  return [...(discussions.get(campaignId) ?? [])]
    .sort(compareComments)
    .map((comment) => toPublicComment(comment, voterId));
}

export function createCampaignDiscussionComment(input: {
  campaignId: string;
  parentId?: string;
  authorName: string;
  authorAddress?: string;
  content: string;
  officialAnswer?: boolean;
  creatorAddress: string;
  now?: number;
}): CampaignDiscussionComment {
  const content = input.content.trim();
  const authorName = input.authorName.trim();
  if (!content || content.length > DISCUSSION_CONTENT_MAX_LENGTH) {
    throw new Error(`Comment must be between 1 and ${DISCUSSION_CONTENT_MAX_LENGTH} characters.`);
  }
  if (!authorName || authorName.length > DISCUSSION_AUTHOR_NAME_MAX_LENGTH) {
    throw new Error(`Name must be between 1 and ${DISCUSSION_AUTHOR_NAME_MAX_LENGTH} characters.`);
  }

  const comments = discussions.get(input.campaignId) ?? [];
  let parentId: string | null = null;
  if (input.parentId) {
    if (!comments.some((comment) => comment.id === input.parentId)) {
      throw new Error("The comment being replied to was not found.");
    }
    parentId = input.parentId;
  }

  const isCreatorReply = Boolean(
    input.authorAddress
      && normalizeAddress(input.authorAddress) === normalizeAddress(input.creatorAddress),
  );
  if (input.officialAnswer && (!isCreatorReply || !parentId)) {
    throw new Error("Only the creator can mark a reply as an official answer.");
  }

  const comment: StoredCampaignDiscussionComment = {
    id: randomUUID(),
    campaignId: input.campaignId,
    parentId,
    authorName,
    ...(input.authorAddress?.trim() ? { authorAddress: input.authorAddress.trim() } : {}),
    content,
    createdAt: input.now ?? Date.now(),
    upvotes: 0,
    voterIds: new Set(),
    isCreatorReply,
    officialAnswer: Boolean(input.officialAnswer),
    pinned: false,
  };
  comments.push(comment);
  discussions.set(input.campaignId, comments);
  return toPublicComment(comment);
}

export function toggleCampaignDiscussionUpvote(
  campaignId: string,
  commentId: string,
  voterId: string,
): CampaignDiscussionComment {
  const normalizedVoterId = voterId.trim();
  if (!normalizedVoterId || normalizedVoterId.length > 120) {
    throw new Error("A valid voter identity is required.");
  }
  const comment = findComment(campaignId, commentId);
  if (!comment) throw new Error("Comment not found.");

  if (comment.voterIds.has(normalizedVoterId)) {
    comment.voterIds.delete(normalizedVoterId);
    comment.upvotes -= 1;
  } else {
    comment.voterIds.add(normalizedVoterId);
    comment.upvotes += 1;
  }
  return toPublicComment(comment, normalizedVoterId);
}

export function toggleCampaignDiscussionPin(input: {
  campaignId: string;
  commentId: string;
  actorAddress: string;
  creatorAddress: string;
}): CampaignDiscussionComment {
  if (!normalizeAddress(input.actorAddress)
    || normalizeAddress(input.actorAddress) !== normalizeAddress(input.creatorAddress)) {
    throw new Error("Only the campaign creator can pin comments.");
  }
  const comment = findComment(input.campaignId, input.commentId);
  if (!comment) throw new Error("Comment not found.");
  comment.pinned = !comment.pinned;
  return toPublicComment(comment);
}

export function resetCampaignDiscussion(): void {
  discussions.clear();
}
