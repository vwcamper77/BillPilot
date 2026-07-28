#!/usr/bin/env swift

import AppKit
import AVFoundation
import Foundation
import QuartzCore

struct RenderSpec {
    let size: CGSize
    let videoFrame: CGRect
    let landscape: Bool
}

guard CommandLine.arguments.count == 6 else {
    FileHandle.standardError.write(Data("Usage: marketing-product-demo-render.swift <source.mov> <vertical.mp4> <landscape.mp4> <vertical-overlay.png> <landscape-overlay.png>\n".utf8))
    exit(64)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let verticalURL = URL(fileURLWithPath: CommandLine.arguments[2])
let landscapeURL = URL(fileURLWithPath: CommandLine.arguments[3])
let verticalOverlayURL = URL(fileURLWithPath: CommandLine.arguments[4])
let landscapeOverlayURL = URL(fileURLWithPath: CommandLine.arguments[5])
let cream = CGColor(red: 251 / 255, green: 247 / 255, blue: 239 / 255, alpha: 1)
let ink = CGColor(red: 20 / 255, green: 60 / 255, blue: 58 / 255, alpha: 1)
let green = CGColor(red: 55 / 255, green: 196 / 255, blue: 142 / 255, alpha: 1)

func addOverlay(_ parent: CALayer, overlayURL: URL, frame: CGRect) throws {
    guard let image = NSImage(contentsOf: overlayURL) else { throw NSError(domain: "ClearTillRender", code: 10, userInfo: [NSLocalizedDescriptionKey: "Unable to load branded overlay."]) }
    var proposed = CGRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &proposed, context: nil, hints: nil) else { throw NSError(domain: "ClearTillRender", code: 11, userInfo: [NSLocalizedDescriptionKey: "Unable to render ClearTill logo."]) }
    let layer = CALayer()
    layer.contents = cgImage
    layer.contentsGravity = .resize
    layer.frame = frame
    parent.addSublayer(layer)
}

func fittedTransform(track: AVAssetTrack, frame: CGRect) -> CGAffineTransform {
    let naturalRect = CGRect(origin: .zero, size: track.naturalSize)
    let orientedRect = naturalRect.applying(track.preferredTransform)
    let orientedSize = CGSize(width: abs(orientedRect.width), height: abs(orientedRect.height))
    let scale = min(frame.width / orientedSize.width, frame.height / orientedSize.height)
    let width = orientedSize.width * scale
    let height = orientedSize.height * scale
    let x = frame.minX + (frame.width - width) / 2
    let y = frame.minY + (frame.height - height) / 2
    var transform = track.preferredTransform
    transform = transform.concatenating(CGAffineTransform(translationX: -orientedRect.minX, y: -orientedRect.minY))
    transform = transform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
    transform = transform.concatenating(CGAffineTransform(translationX: x, y: y))
    return transform
}

func render(sourceURL: URL, outputURL: URL, overlayURL: URL, spec: RenderSpec) throws {
    if FileManager.default.fileExists(atPath: outputURL.path) {
        throw NSError(domain: "ClearTillRender", code: 12, userInfo: [NSLocalizedDescriptionKey: "Refusing to overwrite existing output: \(outputURL.path)"])
    }
    let asset = AVURLAsset(url: sourceURL)
    guard let sourceTrack = asset.tracks(withMediaType: .video).first else { throw NSError(domain: "ClearTillRender", code: 20, userInfo: [NSLocalizedDescriptionKey: "Source contains no video track."]) }
    let sourceDuration = CMTimeGetSeconds(asset.duration)
    let trimStartSeconds = min(1.5, max(0, sourceDuration - 0.1))
    let trimStart = CMTime(seconds: trimStartSeconds, preferredTimescale: 600)
    let duration = CMTimeSubtract(asset.duration, trimStart)

    let composition = AVMutableComposition()
    guard let compositionTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "ClearTillRender", code: 21, userInfo: [NSLocalizedDescriptionKey: "Unable to create video composition track."]) }
    try compositionTrack.insertTimeRange(CMTimeRange(start: trimStart, duration: duration), of: sourceTrack, at: .zero)

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
    instruction.backgroundColor = cream
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionTrack)
    layerInstruction.setTransform(fittedTransform(track: sourceTrack, frame: spec.videoFrame), at: .zero)
    instruction.layerInstructions = [layerInstruction]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = [instruction]
    videoComposition.renderSize = spec.size
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
    let parent = CALayer()
    parent.frame = CGRect(origin: .zero, size: spec.size)
    parent.backgroundColor = cream
    let videoLayer = CALayer()
    videoLayer.frame = parent.frame
    parent.addSublayer(videoLayer)

    try addOverlay(parent, overlayURL: overlayURL, frame: parent.frame)

    videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)
    guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw NSError(domain: "ClearTillRender", code: 30, userInfo: [NSLocalizedDescriptionKey: "Unable to create export session."]) }
    exporter.outputURL = outputURL
    exporter.outputFileType = .mp4
    exporter.shouldOptimizeForNetworkUse = true
    exporter.videoComposition = videoComposition
    let semaphore = DispatchSemaphore(value: 0)
    exporter.exportAsynchronously { semaphore.signal() }
    semaphore.wait()
    guard exporter.status == .completed else { throw exporter.error ?? NSError(domain: "ClearTillRender", code: 31, userInfo: [NSLocalizedDescriptionKey: "Video export failed with status \(exporter.status.rawValue)."])}
}

try FileManager.default.createDirectory(at: verticalURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try render(sourceURL: sourceURL, outputURL: verticalURL, overlayURL: verticalOverlayURL, spec: RenderSpec(size: CGSize(width: 1080, height: 1920), videoFrame: CGRect(x: 40, y: 150, width: 1000, height: 1640), landscape: false))
try render(sourceURL: sourceURL, outputURL: landscapeURL, overlayURL: landscapeOverlayURL, spec: RenderSpec(size: CGSize(width: 1920, height: 1080), videoFrame: CGRect(x: 1240, y: 60, width: 620, height: 960), landscape: true))
print("Rendered \(verticalURL.path) and \(landscapeURL.path)")
