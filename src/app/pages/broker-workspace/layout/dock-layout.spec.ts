import { describe, expect, it } from "vitest";

import {
  DockFractions,
  DockId,
  LayoutInput,
  applyDrag,
  defaultFractions,
  dockSizesPx,
  gridColumns,
  gridRows,
  toolsIsWide,
} from "./dock-layout";

const WIDTH = 1024;
const HEIGHT = 768;

function layout(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return {
    windowWidth: WIDTH,
    windowHeight: HEIGHT,
    fractions: defaultFractions(WIDTH, HEIGHT),
    open: { subscriptions: true, publish: true, tools: false },
    ...overrides,
  };
}

function withTools(overrides: Partial<LayoutInput> = {}): LayoutInput {
  return layout({
    open: { subscriptions: true, publish: true, tools: true },
    ...overrides,
  });
}

/** Runs a whole drag: press, move by `deltaPx`, and fold the result back in. */
function drag(
  input: LayoutInput,
  dock: DockId,
  deltaPx: number,
): DockFractions {
  return applyDrag(input, dock, deltaPx, dockSizesPx(input)[dock]);
}

describe("dockSizesPx", () => {
  it("starts every dock at its default size", () => {
    const sizes = dockSizesPx(layout());

    expect(sizes).toEqual({ subscriptions: 260, publish: 260, tools: 360 });
  });

  it("scales proportionally when the window widens", () => {
    const sizes = dockSizesPx(layout({ windowWidth: 2048 }));

    expect(sizes.subscriptions).toBe(520);
    expect(sizes.tools).toBe(720);
  });

  it("scales the publish dock with the window's height, not its width", () => {
    expect(dockSizesPx(layout({ windowHeight: 1536 })).publish).toBe(520);
    expect(dockSizesPx(layout({ windowWidth: 2048 })).publish).toBe(260);
  });

  it("clamps to the minimum when the window shrinks", () => {
    const sizes = dockSizesPx(layout({ windowWidth: 512, windowHeight: 384 }));

    expect(sizes.subscriptions).toBe(200);
    expect(sizes.publish).toBe(200);
  });

  it("clamps to the maximum when the window grows a lot", () => {
    const sizes = dockSizesPx(
      layout({ windowWidth: 10240, windowHeight: 2304 }),
    );

    expect(sizes.subscriptions).toBe(1200);
    expect(sizes.publish).toBe(560);
  });

  it("does not drift across repeated reads at the same window size", () => {
    const input = layout();
    const first = dockSizesPx(input);

    expect(dockSizesPx(input)).toEqual(first);
    expect(dockSizesPx(input)).toEqual(first);
  });

  it("returns to the original size after the window grows and shrinks back", () => {
    const input = layout();
    const start = dockSizesPx(input);

    dockSizesPx({ ...input, windowWidth: 2048, windowHeight: 1536 });

    expect(dockSizesPx(input)).toEqual(start);
  });

  it("squeezes the tools dock rather than letting the centre column vanish", () => {
    // 1024 wide, 320 reserved for the centre: a 600px sidebar leaves 104,
    // less than the tools dock's 240 minimum.
    const fractions = drag(withTools(), "subscriptions", 340);
    const sizes = dockSizesPx(withTools({ fractions }));

    expect(sizes.subscriptions).toBe(600);
    expect(sizes.tools).toBe(240);
  });

  it("stops squeezing the tools dock once the sidebar is hidden", () => {
    const fractions = drag(withTools(), "subscriptions", 340);
    const sizes = dockSizesPx(
      withTools({
        fractions,
        open: { subscriptions: false, publish: true, tools: true },
      }),
    );

    expect(sizes.tools).toBe(360);
  });

  it("keeps a closed dock's size, so reopening restores it", () => {
    const fractions = drag(withTools(), "tools", -60);
    const closed = dockSizesPx(layout({ fractions }));

    expect(closed.tools).toBe(420);
    expect(dockSizesPx(withTools({ fractions })).tools).toBe(420);
  });
});

describe("gridColumns", () => {
  it("keeps the tools tracks at zero while the dock is closed", () => {
    expect(gridColumns(layout())).toBe("260px 6px 1fr 0 0");
  });

  it("gives the tools dock a track of its own once opened", () => {
    expect(gridColumns(withTools())).toBe("260px 6px 1fr 6px 360px");
  });

  it("keeps the subscriptions tracks at zero while that dock is closed", () => {
    const input = layout({
      open: { subscriptions: false, publish: true, tools: true },
    });

    expect(gridColumns(input)).toBe("0 0 1fr 6px 360px");
  });

  it("leaves the centre column the whole width with both docks closed", () => {
    const input = layout({
      open: { subscriptions: false, publish: false, tools: false },
    });

    expect(gridColumns(input)).toBe("0 0 1fr 0 0");
  });
});

describe("gridRows", () => {
  it("puts the publish dock under the stream", () => {
    expect(gridRows(layout())).toBe("1fr 6px 260px");
  });

  it("keeps its tracks at zero while it is closed", () => {
    const input = layout({
      open: { subscriptions: true, publish: false, tools: true },
    });

    expect(gridRows(input)).toBe("1fr 0 0");
  });
});

describe("applyDrag", () => {
  it("widens the sidebar as its handle is dragged right", () => {
    const fractions = drag(layout(), "subscriptions", 40);

    expect(dockSizesPx(layout({ fractions })).subscriptions).toBe(300);
  });

  it("clamps the sidebar to its minimum and maximum", () => {
    expect(
      dockSizesPx(layout({ fractions: drag(layout(), "subscriptions", -5000) }))
        .subscriptions,
    ).toBe(200);
    expect(
      dockSizesPx(layout({ fractions: drag(layout(), "subscriptions", 5000) }))
        .subscriptions,
    ).toBe(1200);
  });

  it("grows the publish dock as its handle is dragged up", () => {
    const fractions = drag(layout(), "publish", -40);

    expect(dockSizesPx(layout({ fractions })).publish).toBe(300);
  });

  it("clamps the publish dock to its minimum and maximum", () => {
    expect(
      dockSizesPx(layout({ fractions: drag(layout(), "publish", 5000) }))
        .publish,
    ).toBe(200);
    expect(
      dockSizesPx(layout({ fractions: drag(layout(), "publish", -5000) }))
        .publish,
    ).toBe(560);
  });

  it("shrinks the tools dock as its handle is dragged right", () => {
    const fractions = drag(withTools(), "tools", 40);

    expect(dockSizesPx(withTools({ fractions })).tools).toBe(320);
  });

  it("clamps the tools dock to its minimum", () => {
    const fractions = drag(withTools(), "tools", 5000);

    expect(dockSizesPx(withTools({ fractions })).tools).toBe(240);
  });

  it("clamps the tools dock to its maximum when there is room for it", () => {
    const wide = withTools({ windowWidth: 2048 });
    const fractions = drag(wide, "tools", -5000);

    expect(dockSizesPx(withTools({ windowWidth: 2048, fractions })).tools).toBe(
      900,
    );
  });

  it("resolves the drag against where it began, not the last frame", () => {
    const input = layout();
    const start = dockSizesPx(input).subscriptions;

    // Out past the clamp and back again: the fraction has to come from the
    // cumulative delta, or the clamp would have eaten the way back.
    applyDrag(input, "subscriptions", -5000, start);
    const fractions = applyDrag(input, "subscriptions", 0, start);

    expect(dockSizesPx(layout({ fractions })).subscriptions).toBe(start);
  });

  it("leaves the other docks alone", () => {
    const fractions = drag(layout(), "subscriptions", 40);
    const defaults = defaultFractions(WIDTH, HEIGHT);

    expect(fractions.publish).toBe(defaults.publish);
    expect(fractions.tools).toBe(defaults.tools);
  });
});

describe("toolsIsWide", () => {
  it("stays single-column until the dock has room for two", () => {
    expect(toolsIsWide(360)).toBe(false);
    expect(toolsIsWide(559)).toBe(false);
    expect(toolsIsWide(560)).toBe(true);
    expect(toolsIsWide(900)).toBe(true);
  });
});
