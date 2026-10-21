import { beforeEach, describe, expect, it } from "vitest";
import {
  createCampaignDiscussionComment,
  listCampaignDiscussionComments,
  resetCampaignDiscussion,
  toggleCampaignDiscussionPin,
  toggleCampaignDiscussionUpvote,
} from "./campaign-discussion.service";

const campaignId = "campaign-discussion-test";
const creatorAddress = "GCREATOR";

beforeEach(() => resetCampaignDiscussion());

describe("campaign discussion", () => {
  it("creates threaded creator replies and restricts official answers", () => {
    const question = createCampaignDiscussionComment({
      campaignId,
      authorName: "Backer",
      content: "How will the funds be used?",
      creatorAddress,
      now: 100,
    });

    expect(() => createCampaignDiscussionComment({
      campaignId,
      parentId: question.id,
      authorName: "Visitor",
      content: "Following!",
      officialAnswer: true,
      creatorAddress,
    })).toThrow("Only the creator can mark a reply as an official answer.");

    const answer = createCampaignDiscussionComment({
      campaignId,
      parentId: question.id,
      authorName: "Campaign creator",
      authorAddress: creatorAddress,
      content: "Funds go directly to project costs.",
      officialAnswer: true,
      creatorAddress,
      now: 200,
    });

    expect(answer).toMatchObject({
      parentId: question.id,
      isCreatorReply: true,
      officialAnswer: true,
    });
    expect(listCampaignDiscussionComments(campaignId)).toHaveLength(2);
  });

  it("toggles each viewer's upvote and exposes only their own vote state", () => {
    const comment = createCampaignDiscussionComment({
      campaignId,
      authorName: "Visitor",
      content: "A useful comment",
      creatorAddress,
    });

    expect(toggleCampaignDiscussionUpvote(campaignId, comment.id, "viewer-1")).toMatchObject({
      upvotes: 1,
      hasUpvoted: true,
    });
    expect(listCampaignDiscussionComments(campaignId, "viewer-2")[0]).toMatchObject({
      upvotes: 1,
      hasUpvoted: false,
    });
    expect(toggleCampaignDiscussionUpvote(campaignId, comment.id, "viewer-1")).toMatchObject({
      upvotes: 0,
      hasUpvoted: false,
    });
  });

  it("allows only the creator to pin comments and sorts pinned comments first", () => {
    const first = createCampaignDiscussionComment({
      campaignId,
      authorName: "First",
      content: "First comment",
      creatorAddress,
      now: 100,
    });
    const second = createCampaignDiscussionComment({
      campaignId,
      authorName: "Second",
      content: "Second comment",
      creatorAddress,
      now: 200,
    });

    expect(() => toggleCampaignDiscussionPin({
      campaignId,
      commentId: first.id,
      actorAddress: "GOTHER",
      creatorAddress,
    })).toThrow("Only the campaign creator can pin comments.");

    toggleCampaignDiscussionPin({
      campaignId,
      commentId: first.id,
      actorAddress: creatorAddress,
      creatorAddress,
    });
    expect(listCampaignDiscussionComments(campaignId).map(({ id }) => id)).toEqual([first.id, second.id]);
  });
});
