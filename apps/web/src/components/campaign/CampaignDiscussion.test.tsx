import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignDiscussion } from "./CampaignDiscussion";
import type { CampaignDiscussionComment } from "@/services/campaign-discussion.service";

vi.mock("@/providers/StellarWalletProvider", async () => {
  const React = await import("react");
  return { WalletContext: React.createContext(undefined) };
});

const campaignId = "discussion-ui-test";
const comments: CampaignDiscussionComment[] = [];

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

beforeEach(() => {
  comments.splice(0);
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        content: string;
        authorName: string;
        parentId?: string;
      };
      const comment: CampaignDiscussionComment = {
        id: `comment-${comments.length + 1}`,
        campaignId,
        parentId: body.parentId ?? null,
        authorName: body.authorName,
        content: body.content,
        createdAt: Date.now(),
        upvotes: 0,
        hasUpvoted: false,
        isCreatorReply: false,
        officialAnswer: false,
        pinned: false,
      };
      comments.push(comment);
      return jsonResponse({ comment }, 201);
    }
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { commentId: string };
      const comment = comments.find((item) => item.id === body.commentId);
      if (comment) comment.upvotes += 1;
      return jsonResponse({ comment });
    }
    expect(url).toContain(`/${campaignId}/discussion`);
    return jsonResponse({ comments: comments.map((comment) => ({ ...comment })) });
  }));
});

afterEach(() => vi.unstubAllGlobals());

describe("CampaignDiscussion", () => {
  it("lets a visitor post a comment and renders it in the thread", async () => {
    render(<CampaignDiscussion campaignId={campaignId} creatorAddress="GCREATOR" />);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "River" } });
    fireEvent.change(screen.getByLabelText("Add a question or comment"), {
      target: { value: "When does the project begin?" },
    });
    const submitButton = screen.getByRole("button", { name: "Post comment" }) as HTMLButtonElement;
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(comments).toHaveLength(1));
    expect(await screen.findByText("When does the project begin?", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("River", { selector: "span" })).toBeTruthy();
  });

  it("shows nested replies with creator and official-answer badges", async () => {
    comments.push({
      id: "question",
      campaignId,
      parentId: null,
      authorName: "Visitor",
      content: "How are funds used?",
      createdAt: Date.now(),
      upvotes: 0,
      hasUpvoted: false,
      isCreatorReply: false,
      officialAnswer: false,
      pinned: false,
    }, {
      id: "answer",
      campaignId,
      parentId: "question",
      authorName: "Campaign creator",
      content: "Funds support the field team.",
      createdAt: Date.now(),
      upvotes: 2,
      hasUpvoted: false,
      isCreatorReply: true,
      officialAnswer: true,
      pinned: true,
    });

    render(<CampaignDiscussion campaignId={campaignId} creatorAddress="GCREATOR" />);
    expect(await screen.findByText("Funds support the field team.")).toBeTruthy();
    expect(screen.getByText("Official answer")).toBeTruthy();
    expect(screen.getAllByText("Campaign creator")).toHaveLength(2);
    expect(screen.getByText("Pinned")).toBeTruthy();
  });

  it("refreshes the displayed vote count after upvoting", async () => {
    comments.push({
      id: "question",
      campaignId,
      parentId: null,
      authorName: "Visitor",
      content: "A useful question",
      createdAt: Date.now(),
      upvotes: 0,
      hasUpvoted: false,
      isCreatorReply: false,
      officialAnswer: false,
      pinned: false,
    });
    render(<CampaignDiscussion campaignId={campaignId} creatorAddress="GCREATOR" />);
    const voteButton = await screen.findByRole("button", { name: "0 upvotes" });
    fireEvent.click(voteButton);

    await waitFor(() => expect(screen.getByRole("button", { name: "1 upvote" })).toBeTruthy());
  });
});
