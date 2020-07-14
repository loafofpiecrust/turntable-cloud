import "mocha"
import { expect } from "chai"

import { discographyFromDiscogs, discographyFromMusicBrainz, findArtistOnDiscogs, findArtistOnMusicBrainz, combinedDiscography } from "./discography"



describe("discography", function() {
  this.timeout(5000)
  const thanksgivingId = "605448"
  const efterklangId = 234846

  it("works at all", async function() {
    const result = await discographyFromDiscogs(efterklangId)
    expect(result).is.not.empty
    // console.log(result)
  })

  it("searches for artist", async function() {
    const discogs = await findArtistOnDiscogs("Thanksgiving")
    const mb = await findArtistOnMusicBrainz("Thanksgiving")
    console.log(discogs)
    console.log(mb)
  })

  it("grabs from musicbrainz", async function() {
    const efterklang = "8a7bed97-f080-4984-8db5-2ea5c82d8b33"
    const result = await discographyFromMusicBrainz(efterklang)
    const releases = result["release-groups"]
    console.log(`${releases.length} release groups`)
    expect(result).is.not.empty
  })

  it("combines discogs and musicbrainz", async function() {
    const [mb, discogs] = await combinedDiscography("Efterklang")
  })
})