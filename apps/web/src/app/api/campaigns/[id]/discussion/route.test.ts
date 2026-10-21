import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCampaign } from "@/services/campaign.service";
import { resetCampaignDiscussion } from "@/services/campaign-discussion.service";
import { PATCH, POST } from "./route";

vi.mock("@/services/campaign.service", () => ({
  getCampaign: vi.fn(),
}));

const campaignId = "discussion-route-test";
const creatorAddress = "GCREATOR";
const params = Promise.resolve({ id: campaignId });

beforeEach(() => {
  resetCampaignDiscussion();
  vi.mocked(getCampaign).mockResolvedValue({ creator: creatorAddress } as NonNullable<
    Awaited<ReturnType<typeof getCampaign>>
  >);
});

function jsonRequest(body: unknown): Request {
  return new Request(`http://localhost/api/campaigns/${campaignId}/discussion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("campaign discussion API", () => {
  it("rejects a non-creator attempting to mark a reply as official", async () => {
    const response = await POST(jsonRequest({
      authorName: "Visitor",
      content: "An answer",
      parentId: "question-id",
      authorAddress: "GOTHER",
      officialAnswer: true,
    }), { params });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Only the campaign creator can mark a reply as an official answer.",
    });
  });

  it("rejects pinning unless the actor matches the campaign creator", async () => {
    const created = await POST(jsonRequest({
      authorName: "Visitor",
      content: "A comment",
    }), { params });
    const { comment } = await created.json() as { comment: { id: string } };
    const response = await PATCH(new Request(`http://localhost/api/campaigns/${campaignId}/discussion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pin",
        commentId: comment.id,
        actorAddress: "GOTHER",
      }),
    }), { params });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Only the campaign creator can pin comments.",
    });
  });
});
