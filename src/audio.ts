import {
  ITrackBox,
  IHandlerBox,
  IFileTypeBox,
  IChunkOffsetBox,
  IMP4AudioSampleEntry,
  ISampleToChunkBox,
  ISampleSizeBox,
  IESDBox
} from "./interface.box";
import { Finder } from "./finder";
import {
  BOX_TYPE_TRACK_BOX,
  BOX_TYPE_HANDLER_BOX,
  BOX_TYPE_MOVIE_HEADER_BOX,
  BOX_TYPE_TRACK_HEADER_BOX,
  BOX_TYPE_MEDIA_BOX,
  BOX_TYPE_MEDIA_HEADER_BOX,
  BOX_TYPE_MEDIA_INFORMATION_BOX,
  BOX_TYPE_SOUND_MEDIA_HEADER_BOX,
  BOX_TYPE_DATA_INFORMATION_BOX,
  BOX_TYPE_SAMPLE_TABLE_BOX,
  BOX_TYPE_SAMPLE_DESCRIPTION_BOX,
  BOX_TYPE_TIME_TO_SAMPLE_BOX,
  BOX_TYPE_SAMPLE_TO_CHUNK_BOX,
  BOX_TYPE_SAMPLE_SIZE_BOX,
  BOX_TYPE_CHUNK_OFFSET_BOX,
  BOX_TYPE_CHUNK_OFFSET64_BOX,
  BOX_TYPE_MP4_AUDIO_SAMPLE_ENTRY
} from "./statics";
import { parse, getChunks, concatBytes } from "./helpers";
import {
  FileTypeBoxBuilder,
  ChunkOffsetBoxBuilder,
  ChunkOffset64BoxBuilder,
  MediaDataBoxBuilder,
  SampleTableBoxBuilder,
  MediaInformationBoxBuilder,
  MediaBoxBuilder,
  TrackBoxBuilder,
  MovieBoxBuilder,
  MovieHeaderBoxBuilder,
  TrackHeaderBoxBuilder,
  MediaHeaderBoxBuilder,
  HandlerBoxBuilder,
  SoundMediaHeaderBoxBuilder,
  DataEntryUrlBoxBuilder,
  DataReferenceBoxBuilder,
  DataInformationBoxBuilder,
  MP4AudioSampleEntryBuilder,
  SampleDescriptionBoxBuilder,
  TimeToSampleBoxBuilder,
  SampleSizeBoxBuilder,
  SampleToChunkBoxBuilder
} from "./composer.box";
import { DecoderConfigDescriptorParser } from "./parser.descr";
import {
  IDecoderConfigDescriptor,
  ISLConfigDescriptor,
  IESDescriptor
} from "./interface.descr";
import { BitReader } from "./bitreader";

const SAMPLERATE_TABLE = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000
];

function getAudioTrack(tree: any): ITrackBox {
  var audioTrack!: ITrackBox;
  var finder = new Finder(tree);
  finder.findAll(BOX_TYPE_TRACK_BOX).some(box => {
    var hdlr = <IHandlerBox>new Finder(box).findOne(BOX_TYPE_HANDLER_BOX);
    if (hdlr.handlerType === "soun") {
      audioTrack = <ITrackBox>box;
      return true;
    }
    return false;
  });
  return audioTrack;
}

export function createMp4DescriptorSpecificInfo(
  sampleRate: number,
  channels: number
) {
  const sampleFrequencyIndex = SAMPLERATE_TABLE.indexOf(sampleRate);
  const byte1 = (2 << 3) | (sampleFrequencyIndex >> 1);
  const byte2 = ((sampleFrequencyIndex << 7) | (channels << 3)) & 0xff;
  return new Uint8Array([byte1, byte2]);
}

// extract audio. it is stored to MP4 container.
export function extractAudio(bytes: Uint8Array): Uint8Array {
  var tree = parse(bytes);
  var finder = new Finder(tree);
  var offset = 8 * 6;

  var ftyp: IFileTypeBox = {
    majorBrand: "M4A ",
    minorVersion: 1,
    compatibleBrands: ["isom", "M4A ", "mp42"]
  } as IFileTypeBox;

  ftyp.bytes = new FileTypeBoxBuilder(ftyp).build();
  offset += ftyp.bytes.length;

  var mvhd = finder.findOne(BOX_TYPE_MOVIE_HEADER_BOX);
  offset += mvhd.bytes.length;

  var audioTrack = getAudioTrack(tree);

  finder = new Finder(audioTrack);
  var tkhd = finder.findOne(BOX_TYPE_TRACK_HEADER_BOX);
  offset += tkhd.bytes.length;

  finder = new Finder(finder.findOne(BOX_TYPE_MEDIA_BOX));
  var mdhd = finder.findOne(BOX_TYPE_MEDIA_HEADER_BOX);
  var hdlr = finder.findOne(BOX_TYPE_HANDLER_BOX);
  offset += mdhd.bytes.length + hdlr.bytes.length;

  finder = new Finder(finder.findOne(BOX_TYPE_MEDIA_INFORMATION_BOX));
  var smhd = finder.findOne(BOX_TYPE_SOUND_MEDIA_HEADER_BOX);
  var dinf = finder.findOne(BOX_TYPE_DATA_INFORMATION_BOX);
  offset += smhd.bytes.length + dinf.bytes.length;

  finder = new Finder(finder.findOne(BOX_TYPE_SAMPLE_TABLE_BOX));
  var stsd = finder.findOne(BOX_TYPE_SAMPLE_DESCRIPTION_BOX);
  var stts = finder.findOne(BOX_TYPE_TIME_TO_SAMPLE_BOX);
  var stsc = finder.findOne(BOX_TYPE_SAMPLE_TO_CHUNK_BOX);
  var stsz = finder.findOne(BOX_TYPE_SAMPLE_SIZE_BOX);
  var stco = <IChunkOffsetBox>finder.findOne(BOX_TYPE_CHUNK_OFFSET_BOX);
  if (!stco)
    stco = <IChunkOffsetBox>finder.findOne(BOX_TYPE_CHUNK_OFFSET64_BOX);
  var stcoBytes = stco.bytes;
  offset +=
    stsd.bytes.length +
    stts.bytes.length +
    stsc.bytes.length +
    stsz.bytes.length +
    stcoBytes.length;

  var chunks = getChunks(bytes, audioTrack);
  var chunkOffsets: number[] = [offset];
  for (var i = 1, n = chunks.length; i < n; ++i) {
    offset += chunks[i - 1].length;
    chunkOffsets[i] = offset;
  }
  stcoBytes = new (stco.type === BOX_TYPE_CHUNK_OFFSET_BOX
    ? ChunkOffsetBoxBuilder
    : ChunkOffset64BoxBuilder)({
    entryCount: stco.entryCount,
    chunkOffsets: chunkOffsets
  }).build();
  var mdatBytes = new MediaDataBoxBuilder({
    data: concatBytes(chunks)
  }).build();

  var stblBytes = new SampleTableBoxBuilder([
    stsd,
    stts,
    stsc,
    stsz,
    stcoBytes
  ]).build();
  var minfBytes = new MediaInformationBoxBuilder([
    smhd,
    dinf,
    stblBytes
  ]).build();
  var mdiaBytes = new MediaBoxBuilder([mdhd, hdlr, minfBytes]).build();
  var trakBytes = new TrackBoxBuilder([tkhd, mdiaBytes]).build();
  var moovBytes = new MovieBoxBuilder([mvhd, trakBytes]).build();

  return concatBytes([ftyp.bytes, moovBytes, mdatBytes]);
}

function extractAudioAsAAC(bytes: Uint8Array, audioTrack: any): Uint8Array {
  var finder = new Finder(audioTrack);

  var mp4a = <IMP4AudioSampleEntry>(
    finder.findOne(BOX_TYPE_MP4_AUDIO_SAMPLE_ENTRY)
  );
  var stsc = <ISampleToChunkBox>finder.findOne(BOX_TYPE_SAMPLE_TO_CHUNK_BOX);
  var stsz = <ISampleSizeBox>finder.findOne(BOX_TYPE_SAMPLE_SIZE_BOX);
  var stco = <IChunkOffsetBox>finder.findOne(BOX_TYPE_CHUNK_OFFSET_BOX);
  if (!stco)
    stco = <IChunkOffsetBox>finder.findOne(BOX_TYPE_CHUNK_OFFSET64_BOX);

  var ret = new Uint8Array(
    stsz.sampleSizes.length * 7 + stsz.sampleSizes.reduce((a, b) => a + b)
  );
  var offset = 0;

  var aacHeader = new Uint8Array(7);
  aacHeader[0] = 0xff;
  aacHeader[1] = 0xf9;
  aacHeader[2] =
    0x40 |
    (SAMPLERATE_TABLE.indexOf(mp4a.sampleRate) << 2) |
    (mp4a.channelCount >> 2);
  aacHeader[6] = 0xfc;

  var i, j, k, idx, n, m, l, chunkOffset, sampleSize;

  for (i = 0, idx = 0, n = stsc.entryCount; i < n; ++i) {
    j = stsc.entries[i].firstChunk - 1;
    m =
      i + 1 < n ? stsc.entries[i + 1].firstChunk - 1 : stco.chunkOffsets.length;
    for (; j < m; ++j) {
      chunkOffset = stco.chunkOffsets[j];
      for (k = 0, l = stsc.entries[i].samplesPerChunk; k < l; ++k, ++idx) {
        sampleSize = stsz.sampleSizes[idx] + 7;
        aacHeader[3] = (mp4a.channelCount << 6) | (sampleSize >> 11);
        aacHeader[4] = sampleSize >> 3;
        aacHeader[5] = (sampleSize << 5) | (0x7ff >> 6);
        ret.set(aacHeader, offset);
        offset += 7;
        ret.set(
          bytes.subarray(chunkOffset, (chunkOffset += stsz.sampleSizes[idx])),
          offset
        );
        offset += stsz.sampleSizes[idx];
      }
    }
  }

  return ret;
}

function extractAudioAsMP3(bytes: Uint8Array, audioTrack: any): Uint8Array {
  return concatBytes(getChunks(bytes, audioTrack));
}

export function extractRawAudio(
  bytes: Uint8Array
): { type: string; data: Uint8Array } {
  var tree = parse(bytes);
  var audioTrack = getAudioTrack(tree);
  var finder = new Finder(audioTrack);
  var mp4a = <IMP4AudioSampleEntry>(
    finder.findOne(BOX_TYPE_MP4_AUDIO_SAMPLE_ENTRY)
  );
  var OBJECT_TYPE_INDICATION =
    DecoderConfigDescriptorParser.OBJECT_TYPE_INDICATION;
  switch (mp4a.esBox.esDescr.decConfigDescr.objectTypeIndication) {
    case OBJECT_TYPE_INDICATION.AAC:
      return { type: "aac", data: extractAudioAsAAC(bytes, audioTrack) };
    case OBJECT_TYPE_INDICATION.MP3:
      return { type: "mp3", data: extractAudioAsMP3(bytes, audioTrack) };
    default:
      throw new TypeError("not supported object type indication.");
  }
}

export function aacToM4a(bytes: Uint8Array): Uint8Array {
  var bitReader = new BitReader(bytes);
  var offset = 8 * 6;

  bitReader.skipBits(12);
  var aacInfo = {
    id: bitReader.readBits(1),
    layer: bitReader.readBits(2),
    protectionAbsent: bitReader.readBits(1),
    profile: bitReader.readBits(2),
    sampleingFrequencyIndex: bitReader.readBits(4),
    privateBit: bitReader.readBits(1),
    channelConfiguration: bitReader.readBits(3),
    original: bitReader.readBits(1),
    home: bitReader.readBits(1),
    copyrightIndentificationBit: bitReader.readBits(1),
    copyrightIndentificationStart: bitReader.readBits(1),
    aacFrameLength: bitReader.readBits(13),
    atdsBufferFullness: bitReader.readBits(11),
    noRawDataBlocksInFrames: bitReader.readBits(2)
  };
  bitReader.bitOffset = 0;

  var samples: Uint8Array[] = [];
  var frameLength: number;
  var bufferSizeDB = 0;
  while (!bitReader.eof()) {
    bitReader.skipBits(30);
    frameLength = bitReader.readBits(13);
    bitReader.skipBits(13);
    samples.push(bitReader.readBytes(frameLength - 7));
    bufferSizeDB = Math.max(bufferSizeDB, frameLength - 7);
  }

  var ftypBytes = new FileTypeBoxBuilder({
    majorBrand: "M4A ",
    minorVersion: 1,
    compatibleBrands: ["isom", "M4A ", "mp42"]
  }).build();
  offset += ftypBytes.length;

  var creationTime = Date.now();
  var timescale = 600;
  var sampleRate = SAMPLERATE_TABLE[aacInfo.sampleingFrequencyIndex];
  var duration = ((samples.length * 1024 * timescale) / sampleRate) | 0;
  var matrix = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

  var mvhdBytes = new MovieHeaderBoxBuilder({
    creationTime: creationTime,
    modificationTime: creationTime,
    timescale: timescale,
    duration: duration,
    rate: 1.0,
    volume: 1.0,
    matrix: matrix,
    nextTrackID: 2
  }).build();
  offset += mvhdBytes.length;

  var tkhdBytes = new TrackHeaderBoxBuilder({
    flags: 0x000001,
    creationTime: creationTime,
    modificationTime: creationTime,
    trackID: 1,
    duration: duration,
    layer: 0,
    alternateGroup: 0,
    volume: 1.0,
    matrix: matrix,
    width: 0,
    height: 0
  }).build();
  offset += tkhdBytes.length;

  var mdhdBytes = new MediaHeaderBoxBuilder({
    creationTime: creationTime,
    modificationTime: creationTime,
    timescale: timescale,
    duration: duration,
    language: "und"
  }).build();
  offset += mdhdBytes.length;

  var hdlrBytes = new HandlerBoxBuilder({
    handlerType: "soun",
    name: "mp4.js sound media handler"
  }).build();
  offset += hdlrBytes.length;

  var smhdBytes = new SoundMediaHeaderBoxBuilder({
    balance: 0
  }).build();
  offset += smhdBytes.length;

  var urlBytes = new DataEntryUrlBoxBuilder({
    flags: 0x000001,
    location: ""
  }).build();

  var drefBytes = new DataReferenceBoxBuilder({
    entryCount: 1,
    entries: [urlBytes]
  }).build();

  var dinfBytes = new DataInformationBoxBuilder([drefBytes]).build();
  offset += dinfBytes.length;

  var OBJECT_TYPE_INDICATION =
    DecoderConfigDescriptorParser.OBJECT_TYPE_INDICATION;
  var decConfigDescr: IDecoderConfigDescriptor = {
    objectTypeIndication: OBJECT_TYPE_INDICATION.AAC,
    streamType: 0x05,
    upStream: 0,
    bufferSizeDB: bufferSizeDB,
    maxBitrate: 0,
    avgBitrate: 0,
    decSpecificInfo: {
      data: createMp4DescriptorSpecificInfo(
        sampleRate,
        aacInfo.channelConfiguration
      )
    }
  };

  var slConfigDescr: ISLConfigDescriptor = {
    preDefined: 2
  };

  var esDescr: IESDescriptor = {
    esID: 0,
    streamDependenceFlag: 0,
    urlFlag: 0,
    ocrStreamFlag: 0,
    streamPriority: 0,
    decConfigDescr: decConfigDescr,
    slConfigDescr: slConfigDescr
  };

  var esBox: IESDBox = {
    esDescr: esDescr
  };

  var audioSampleEntry: IMP4AudioSampleEntry = {
    type: BOX_TYPE_MP4_AUDIO_SAMPLE_ENTRY,
    dataReferenceIndex: 1,
    channelCount: aacInfo.channelConfiguration,
    sampleSize: 16,
    sampleRate: sampleRate,
    esBox: esBox
  };

  var mp4aBytes = new MP4AudioSampleEntryBuilder({
    type: BOX_TYPE_MP4_AUDIO_SAMPLE_ENTRY,
    dataReferenceIndex: 1,
    channelCount: aacInfo.channelConfiguration,
    sampleSize: 16,
    sampleRate: sampleRate,
    esBox: esBox
  }).build();

  var stsdBytes = new SampleDescriptionBoxBuilder({
    entryCount: 1,
    boxes: [audioSampleEntry]
  }).build();
  offset += stsdBytes.length;

  var sttsBytes = new TimeToSampleBoxBuilder({
    entryCount: 1,
    entries: [{ sampleCount: samples.length, sampleDelta: 1024 }]
  }).build();
  offset += sttsBytes.length;

  var stszBytes = new SampleSizeBoxBuilder({
    sampleSize: 0,
    sampleCount: samples.length,
    sampleSizes: samples.map(sample => sample.byteLength)
  }).build();
  offset += stszBytes.length;

  var mod16 = samples.length % 16;
  var stscEntryCount = mod16 ? 2 : 1;
  var stscEntries = [
    {
      firstChunk: 1,
      samplesPerChunk: 16,
      sampleDescriptionIndex: 1
    }
  ];
  if (stscEntryCount === 2) {
    stscEntries.push({
      firstChunk: Math.floor(samples.length / 16) + 1,
      samplesPerChunk: mod16,
      sampleDescriptionIndex: 1
    });
  }
  var stscBytes = new SampleToChunkBoxBuilder({
    entryCount: stscEntryCount,
    entries: stscEntries
  }).build();
  offset += stscBytes.length;

  var stcoEntryCount = Math.ceil(samples.length / 16);
  offset += 4 + stcoEntryCount * 4 + /* header length */ 12;
  var chunkOffset = offset;
  var chunkOffsets = [];
  for (var i = 0, n = samples.length; i < n; ++i) {
    if (i % 16 === 0) chunkOffsets.push(chunkOffset);
    chunkOffset += samples[i].byteLength;
  }
  var stcoBytes = new ChunkOffsetBoxBuilder({
    entryCount: stcoEntryCount,
    chunkOffsets: chunkOffsets
  }).build();

  var stblBytes = new SampleTableBoxBuilder([
    stsdBytes,
    sttsBytes,
    stszBytes,
    stscBytes,
    stcoBytes
  ]).build();
  var minfBytes = new MediaInformationBoxBuilder([
    smhdBytes,
    dinfBytes,
    stblBytes
  ]).build();
  var mdiaBytes = new MediaBoxBuilder([
    mdhdBytes,
    hdlrBytes,
    minfBytes
  ]).build();
  var trakBytes = new TrackBoxBuilder([tkhdBytes, mdiaBytes]).build();
  var moovBytes = new MovieBoxBuilder([mvhdBytes, trakBytes]).build();
  var mdatBytes = new MediaDataBoxBuilder({
    data: concatBytes(samples)
  }).build();

  return concatBytes([ftypBytes, moovBytes, mdatBytes]);
}
