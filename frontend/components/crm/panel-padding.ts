/**
 * The thread panel's inner padding, in pixels: the value of the `p-4` on the
 * panel in crm-app.tsx.
 *
 * Both sheets subtract it when they declare how much of the scrolling region
 * they cover, because the region stops at the panel's bottom padding while a
 * pinned sheet runs on to the panel's inner edge. Before this constant each
 * sheet wrote its own 16, and a change to the panel's padding would have
 * falsified both reserves in silence.
 *
 * A Tailwind class cannot be driven by a constant, so this file and the `p-4`
 * cannot enforce each other: naming the coupling in both directions is the
 * whole available fix. If the class changes, this value must change with it;
 * the comment on the class in crm-app.tsx points back here.
 *
 * A module of its own because of the import direction: crm-app.tsx imports
 * both sheets, so the sheets cannot read this off crm-app.tsx without a cycle.
 */
export const PANEL_PADDING_PX = 16;
