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

async function findSongOnYouTube(song: Song): Promise<string> {
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
  if (validChoices.length === 0) {
    return null
  }

  // either pick the first great match or best overall.
  const firstPick = validChoices.find(choice => choice.matchRatio >= 90)

  if (firstPick) {
    return firstPick.id
  } else {
    let best = validChoices[0]
    for (const choice of validChoices) {
      if (choice.matchRatio > best.matchRatio) {
        best = choice
      }
    }
    return best.id
  }
}

async function findStream(song: Song) {
  const videoId = await findSongOnYouTube(song)

  if (!videoId) {
    return {
      highQuality: null,
      lowQuality: null,
    }
  }

  let info: ytdl.videoInfo;
  try {
    info = await ytdl.getInfo(videoId)
  } catch (err) {
    // console.error(`Failed to retrieve info for video '${videoId}'`)
    throw err
  }

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
  
  return {
    id: videoId,
    highQuality: hq ? simplifyStreamFormat(hq) : null,
    lowQuality: simplifyStreamFormat(lq),
    duration: Number.parseInt(info.length_seconds) * 1000,
    expiryDate,
    lifespan: expiryDate - now,
  }
}

/// ? Search youtube for match here on server.
export const handler = async (event: APIGatewayProxyEvent) => {
  const q = event.queryStringParameters
  const song = {
    title: q.title,
    album: q.album,
    artist: q.artist,
    albumArtist: q.albumArtist || q.artist,
    duration: q.duration ? Number.parseInt(q.duration) : 0,
  }

  const result = await findStream(song)

  return {
    statusCode: 200,
    body: JSON.stringify(result),
  } as APIGatewayProxyResult
}

// TODO: Album search + parse track listing from description
