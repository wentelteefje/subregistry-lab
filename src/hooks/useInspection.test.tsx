import { useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInspection } from "./useInspection";
import type {
  InspectionData,
  InspectedRecord,
  Profile,
} from "../lib/inspection";
const harness = vi.hoisted(() => ({
  inspect: vi.fn(),
  profile: vi.fn(),
  client: {},
}));
vi.mock("wagmi", () => ({ usePublicClient: () => harness.client }));
vi.mock("../lib/inspection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/inspection")>()),
  readInspection: harness.inspect,
  readProfile: harness.profile,
}));
const target = {
  kind: "name" as const,
  resolver: "0x1111111111111111111111111111111111111111" as const,
  name: "alice.lab.eth",
};
let result: ReturnType<typeof useInspection>;
let renderer: ReactTestRenderer;
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Subject({ profiles }: { profiles: Profile[] }) {
  const value = useInspection(target, 11155111, undefined, profiles);
  useLayoutEffect(() => {
    result = value;
  }, [value]);
  return null;
}
const render = (profiles: Profile[]) => (
  <QueryClientProvider client={queryClient}>
    <Subject profiles={profiles} />
  </QueryClientProvider>
);
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  queryClient.clear();
  vi.clearAllMocks();
});
describe("inspection query caching", () => {
  it("reuses the base scan and pinned block while adding profiles, retaining earlier values", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    harness.inspect.mockResolvedValue({
      target,
      block: 100n,
      records: [],
    } satisfies InspectionData);
    harness.profile.mockImplementation(
      async (_client, _address, _name, profile) => ({
        profile,
        value: "first value",
      }),
    );
    await act(async () => {
      renderer = create(render([]));
    });
    await settle();
    await act(async () =>
      renderer.update(render([{ kind: "text", key: "first" }])),
    );
    await settle();
    expect(result.data?.records?.[0].value).toBe("first value");
    let finish!: (value: InspectedRecord) => void;
    harness.profile.mockImplementation((_client, _address, _name, profile) =>
      profile.key === "second"
        ? new Promise<InspectedRecord>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ profile, value: "first value" }),
    );
    await act(async () =>
      renderer.update(
        render([
          { kind: "text", key: "first" },
          { kind: "text", key: "second" },
        ]),
      ),
    );
    await settle();
    expect(result.data?.records?.[0].value).toBe("first value");
    expect(harness.inspect).toHaveBeenCalledTimes(1);
    expect(harness.profile.mock.calls.every((call) => call[4] === 100n)).toBe(
      true,
    );
    expect(
      (
        queryClient
          .getQueryCache()
          .find({
            queryKey: ["diagram-inspection", 11155111, target, undefined],
          })?.options as { refetchOnWindowFocus?: boolean }
      )?.refetchOnWindowFocus,
    ).toBe(false);
    await act(async () =>
      finish({
        profile: { kind: "text", key: "second" },
        value: "second value",
      }),
    );
    await settle();
    expect(result.data?.records).toHaveLength(2);
  });
});

it("exposes manual lookup errors and retries them without repeating the base scan", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT:true });
  harness.inspect.mockResolvedValue({target,block:100n,records:[]});
  harness.profile.mockRejectedValue(Error("snapshot too old"));
  await act(async () => { renderer=create(render([{kind:"text",key:"custom"}])); });
  await settle();
  await settle();
  expect(result.manualError?.message).toBe("snapshot too old");
  harness.profile.mockResolvedValue({profile:{kind:"text",key:"custom"},value:"confirmed"});
  await act(async () => result.retryManual());
  await settle();
  expect(result.manualError).toBeNull();
  expect(result.data?.records?.[0].value).toBe("confirmed");
  expect(harness.inspect).toHaveBeenCalledTimes(1);
});
