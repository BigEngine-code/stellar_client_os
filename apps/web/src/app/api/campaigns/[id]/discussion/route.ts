import { getCampaign } from "@/services/campaign.service";
import {
  createCampaignDiscussionComment,
  listCampaignDiscussionComments,
  toggleCampaignDiscussionPin,
  toggleCampaignDiscussionUpvote,
} from "@/services/campaign-discussion.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404, headers });

  const voterId = new URL(request.url).searchParams.get("voterId") ?? undefined;
  return Response.json({ comments: listCampaignDiscussionComments(id, voterId) }, { headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404, headers });

  try {
    const body = await request.json() as {
      parentId?: string;
      authorName?: string;
      authorAddress?: string;
      content?: string;
      officialAnswer?: boolean;
    };
    if (body.officialAnswer
      && body.authorAddress?.trim().toLowerCase() !== campaign.creator.trim().toLowerCase()) {
      return Response.json(
        { error: "Only the campaign creator can mark a reply as an official answer." },
        { status: 403, headers },
      );
    }
    const comment = createCampaignDiscussionComment({
      campaignId: id,
      parentId: body.parentId,
      authorName: body.authorName ?? "",
      authorAddress: body.authorAddress,
      content: body.content ?? "",
      officialAnswer: body.officialAnswer,
      creatorAddress: campaign.creator,
    });
    return Response.json({ comment }, { status: 201, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the comment.";
    return Response.json({ error: message }, { status: 400, headers });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) return Response.json({ error: "Campaign not found." }, { status: 404, headers });

  try {
    const body = await request.json() as {
      action?: "upvote" | "pin";
      commentId?: string;
      voterId?: string;
      actorAddress?: string;
    };
    if (!body.commentId) {
      return Response.json({ error: "commentId is required." }, { status: 400, headers });
    }

    if (body.action === "upvote") {
      if (!body.voterId) {
        return Response.json({ error: "voterId is required." }, { status: 400, headers });
      }
      const comment = toggleCampaignDiscussionUpvote(id, body.commentId, body.voterId);
      return Response.json({ comment }, { headers });
    }

    if (body.action === "pin") {
      const comment = toggleCampaignDiscussionPin({
        campaignId: id,
        commentId: body.commentId,
        actorAddress: body.actorAddress ?? "",
        creatorAddress: campaign.creator,
      });
      return Response.json({ comment }, { headers });
    }

    return Response.json({ error: "Unknown discussion action." }, { status: 400, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the comment.";
    const status = message === "Comment not found."
      ? 404
      : message === "Only the campaign creator can pin comments."
        ? 403
        : 400;
    return Response.json({ error: message }, { status, headers });
  }
}
