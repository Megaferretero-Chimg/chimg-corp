export function getLessonBlocks(lesson) {
  const blocks = lesson?.blocks ?? [
    ...(lesson?.content ? [{ kind: "text", parts: [{ style: "paragraph", text: lesson.content }] }] : []),
    ...(lesson?.media ?? []).map((asset) => ({ kind: asset.kind, asset })),
  ];
  return blocks.map((block, index) => {
    const key = "saved-" + index;
    if (block.kind !== "image" && block.kind !== "video") return { ...block, key };
    const assets = block.assets ?? block.images ?? (block.asset ? [block.asset] : []);
    return { kind: block.kind, label: block.label, assets, key };
  });
}
