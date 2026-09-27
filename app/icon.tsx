import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { ImageResponse } from "next/og"

export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default async function Icon() {
  const artwork = await readFile(
    join(process.cwd(), "public/alpha-edge-favicon-mark.png"),
  )

  return new ImageResponse(
    (
      <img
        src={`data:image/png;base64,${artwork.toString("base64")}`}
        alt=""
        width={size.width}
        height={size.height}
        style={{ borderRadius: "33px 13px / 50%" }}
      />
    ),
    size,
  )
}
