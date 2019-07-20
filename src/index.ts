import ytdl from 'ytdl-core'
import fuzzball from 'fuzzball'
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import scrapeYt from 'scrape-youtube'

const PAT_UNOFFICIAL = /\b(live|remix|mix|cover|unofficial|instrumental|sessions)\b/i
const PAT_EXPIRY = /\bexpire=(\d+)\b/

const fuzzyOpts = {
  useCollator: true,
  force_ascii: false,
  full_process: true,
}

interface Song {
  title: string
  album: string
  artist: string
  albumArtist: string
  duration: number // milliseconds
}

function expiryDateFromStreamUrl(url: string): number {
  const m = PAT_EXPIRY.exec(url)
  if (m !== null) {
    return Number.parseInt(m[1]) * 1000
  } else {
    return 0
  }
}

const simplifyStreamFormat = (format: ytdl.videoFormat) => ({
  url: format.url,
  format: format.audioEncoding,
  bitrate: format.audioBitrate,
})

async function findSongOnYouTube(song: Song): Promise<string[]> {
  let query = `${song.title} ${song.artist}`
  if (song.album && song.album !== song.artist && song.album.length <= 40) {
    query = `${query} ${song.album}`
  }
  
  const res = await scrapeYt(query, {
    limit: 6,
    type: "video",
  })

  const choices: any[] = await Promise.all(res.map(async (yt) => {
    let matchRatio = fuzzball.partial_ratio(yt.title, song.title, fuzzyOpts)
    if (matchRatio < 75) {
      return null
    }

    const m = PAT_UNOFFICIAL.exec(yt.title)
    if (m && !song.title.includes(m[0])) {
      return null
    }

    // const dateMatch = PAT_DATE.exec(ytTitle)
    // if (dateMatch && !song.title.includes(dateMatch[0])) {
    //   return null
    // }

    if (song.duration > 0) {
      const vidDuration = yt.duration * 1000
      const durationDiff = Math.abs(vidDuration - song.duration)
      if (song.duration > 0 && vidDuration > 0 && durationDiff > 90_000) {
        return null
      }

      // The further the result is in duration, the worse score it gets
      if (song.duration > 0) {
        if (vidDuration > 0) {
          matchRatio -= durationDiff / 2000
        } else {
          matchRatio -= 5
        }
      }
    }

    const desc = (yt.description || "").toLowerCase()

    let artistMatch = fuzzball.partial_ratio(song.artist, yt.channel, fuzzyOpts)
    if (artistMatch < 85) {
      artistMatch = fuzzball.partial_ratio(song.artist, yt.title, fuzzyOpts)
      if (artistMatch < 85 && !desc.includes(song.artist)) {
        matchRatio -= 5
      }
    } else {
      // this is (maybe) directly from the artist
      matchRatio += 2
    }

    if (song.album && matchRatio < 85) {
      const albumMatch = fuzzball.partial_ratio(song.album, yt.title, fuzzyOpts)
      if (albumMatch > 85 || desc.includes(song.album)) {
        matchRatio += 5
      }
    }
    

    if (matchRatio >= 80) {
      const videoId = yt.link.substring(28)
      return { matchRatio, id: videoId }
    } else {
      return null
    }
  }))

  const validChoices = choices.filter(x => x !== null)
  validChoices.sort((a, b) => b.matchRatio - a.matchRatio)
  return validChoices.map(x => x.id)
}


async function findStream(song: Song) {
  // consider the three best options
  const videoIds = (await findSongOnYouTube(song)).slice(0, 3)

  for (const videoId of videoIds) {
    const info = await ytdl.getInfo(videoId)

    const formats = ytdl.filterFormats(info.formats, "audioonly")
    // Respond with relevant streams: pick a low and high quality.
    let hq = formats[0]
    let lq = null
    // TODO: Prioritize format types!
    for (const f of formats) {
      if (f.audioBitrate > hq.audioBitrate) {
        hq = f
      }
    }
    for (const f of formats) {
      if ((!lq || f.audioBitrate > lq.audioBitrate) && f.audioBitrate < hq.audioBitrate && f.audioBitrate >= 100) {
        lq = f
      }
    }

    // Always provide a standard stream, only hq if there are multiple options.
    if (lq === null) {
      lq = hq
      hq = null
    }

    const now = Date.now()
    const expiryDate = expiryDateFromStreamUrl(lq.url)

    // this stream couldn't be fully decoded, try the next one.
    if (expiryDate === 0) {
      continue
    }
    
    return {
      id: videoId,
      highQuality: hq ? simplifyStreamFormat(hq) : null,
      lowQuality: simplifyStreamFormat(lq),
      duration: Number.parseInt(info.length_seconds) * 1000,
      expiryDate,
      lifespan: expiryDate - now,
    }
  }

  return {
    highQuality: null,
    lowQuality: null,
  }
}

/// ? Search youtube for match here on server.
export const handler = async (event: APIGatewayProxyEvent) => {
  const isFromAPI = event.queryStringParameters ? true : false;
  // allows calling lambda directly or from an API endpoint
  const q = (event.queryStringParameters || event) as any
  const song = {
    title: q.title,
    album: q.album,
    artist: q.artist,
    albumArtist: q.albumArtist || q.artist,
    duration: q.duration ? Number.parseInt(q.duration) : 0,
  }

  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = await findStream(song)
    if (result.expiryDate !== 0) {
      break
    }
  }

  if (isFromAPI) {
    return {
      statusCode: 200,
      body: JSON.stringify(result),
    } as APIGatewayProxyResult
  } else {
    return result
  }
}

// TODO: Album search + parse track listing from description
