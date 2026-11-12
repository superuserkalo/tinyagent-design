// The design frame's URL. The frame is cached for an hour, so a change to what it loads
// (vgpu, the error and screenshot reporter) bumps the version to reach every visitor.
import { VGPU_VERSION } from "./vgpu-version.ts";

export const PREVIEW_FRAME = `/preview-frame?v=${VGPU_VERSION}-2`;
