import { APIGatewayProxyEvent } from "aws-lambda"
import cheerio from "cheerio"
import Axios from "axios"
import { AlbumType, Album } from "./types"
import Discojs from "discojs"
import { MusicBrainzApi } from "musicbrainz-api"

const musicBrainz = new MusicBrainzApi()

const DISCOGS_API_KEY = "IkcHFvQhLxHVLqgyZbLw"
const DISCOGS_API_SECRET = "EYvAdLqDPejAslLuXEYsJdSWkOgADRQp"

const discogs = new Discojs({
  consumerKey: DISCOGS_API_KEY,
  consumerSecret: DISCOGS_API_SECRET,
})

export const discographyFromDiscogs = async (artistId: number) => {
  const res = await Axios.get(`https://www.discogs.com/artist/${artistId}`, {
    params: {
      limit: 500,
      sort: "year,desc"
    },
  })
  const html = cheerio.load(res.data)
  
  let currType: AlbumType = "LP"
  const albums: Album[] = []
  const rows = html("#artist > tbody > tr")
  for (const elem of rows.get() as CheerioElement[]) {
    const className = elem.attribs["class"]
    if (className.includes("credit_header")) {
      // this is a new section of releases.
      const section = html("> td > h3", elem).text()
      if (section === "Albums") {
        currType = "LP"
      } else if (section === "Singles & EPs") {
        currType = "EP"
      } else if (section === "Miscellaneous") {
        currType = "Other"
      }
    } else {
      // this is an individual release.      
      const title = html("> td.title > a", elem).text()
      const thumbnailUrl = html("> td.image > a img", elem).attr("data-src")
      const artist = html("> td.artist > a", elem).text()
      const label = html("> td.label > a", elem).first().text()
      const year = html("> td.year", elem).text()

      const formatText = html("> td.title .format", elem).text()
      const formats = formatText.slice(1, formatText.length - 1).split(", ")
      let type: AlbumType = currType
      if (formats.includes("EP")) {
        type = "EP"
      } else if (formats.includes("7\"") || formats.includes("Single")) {
        type = "Single"
      }


      albums.push({
        type,
        title,
        artist,
        label,
        thumbnailUrl,
        year: Number.parseInt(year) || undefined,
      })
    }
  }
  return albums
}

export const findArtistOnDiscogs = async (name: string) => {
  // TODO: find best match
  return (await discogs.searchArtist(name)).results[0]
}

export const findArtistOnMusicBrainz = async (name: string) => {
  // TODO: find best match
  return (await musicBrainz.searchArtist(name, 0, 10)).artists[0]
}

export const discographyFromMusicBrainz = async (artistId: string) => {
  return musicBrainz.getArtist(artistId, ["release-groups", "releases"])
}

export const searchArtists = async (query: string) => {
  const { results: discogsResults } = await discogs.searchArtist(query)
  const { artists: mbResults } = await musicBrainz.searchArtist(query)
}


export const combinedDiscography = async (artistName: string) => {
  const [dcReleases, mbReleases] = await Promise.all([
    findArtistOnDiscogs(artistName).then(a => discographyFromDiscogs(a.id)),
    findArtistOnMusicBrainz(artistName).then(a => discographyFromMusicBrainz(a.id)),
  ])

  return [dcReleases, mbReleases]
}

export const handler = (event: APIGatewayProxyEvent) => {
  const q = event.queryStringParameters
  const artistName = q.artist
}