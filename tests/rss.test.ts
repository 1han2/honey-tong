import { describe, expect, it, vi } from "vitest";
import { YouTubeRssClient } from "../src/lib/rss.js";
import { channelFixture } from "./fixtures.js";

describe("YouTubeRssClient", () => {
  it("parses a YouTube Atom feed", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
        <entry>
          <yt:videoId>abcDEF12345</yt:videoId>
          <title>제품 사용기</title>
          <published>2026-08-01T00:00:00+00:00</published>
        </entry>
      </feed>`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(xml, { status: 200, headers: { "content-type": "application/atom+xml" } }),
    );
    const videos = await new YouTubeRssClient(fetchMock).fetchLatest(channelFixture);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      videoId: "abcDEF12345",
      channelId: channelFixture.youtubeChannelId,
      videoUrl: "https://www.youtube.com/watch?v=abcDEF12345",
    });
  });

  it("falls back to the public YouTube browse response when RSS returns 404", async () => {
    const browse = {
      contents: {
        richGridRenderer: {
          contents: [
            {
              richItemRenderer: {
                content: {
                  lockupViewModel: {
                    contentId: "abcDEF12345",
                    contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                    lockupMetadataViewModel: {
                      title: { content: "최근 제품 사용기" },
                      metadata: {
                        contentMetadataViewModel: {
                          metadataRows: [
                            {
                              metadataParts: [
                                { text: { content: "조회수 1천회" } },
                                { text: { content: "2일 전" }, accessibilityLabel: "2일 전" },
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(browse), { status: 200 }));

    const videos = await new YouTubeRssClient(fetchMock).fetchLatest(channelFixture);
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      videoId: "abcDEF12345",
      title: "최근 제품 사용기",
      channelId: channelFixture.youtubeChannelId,
    });
    expect(Date.parse(videos[0]!.publishedAt)).toBeGreaterThan(Date.now() - 3 * 24 * 60 * 60 * 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
