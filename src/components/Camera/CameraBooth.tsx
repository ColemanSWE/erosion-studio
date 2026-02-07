import React, { useRef, useEffect, useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import styles from "./CameraBooth.module.scss";
import { useUIStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { renderWithEffects } from "../../lib/effects/effects-renderer";
import { detectFaces, type FaceBounds } from "../../lib/effects/face-detector";
import type { Region } from "../../lib/effects/types";

interface CanvasBounds {
    left: number;
    top: number;
    width: number;
    height: number;
}

const REGION_COLORS = ["#ff3366", "#33ccff", "#ffcc00", "#66ff66", "#cc66ff", "#ff9933"];

function getCanvasContentBounds(
    canvas: HTMLCanvasElement,
    parent: HTMLElement
): CanvasBounds {
    const canvasRect = canvas.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();

    const cssW = canvasRect.width;
    const cssH = canvasRect.height;

    if (canvas.width === 0 || canvas.height === 0) {
        return { left: canvasRect.left - parentRect.left, top: canvasRect.top - parentRect.top, width: cssW, height: cssH };
    }

    const contentAspect = canvas.width / canvas.height;
    const cssAspect = cssW / cssH;

    let contentW: number, contentH: number, contentOffsetX: number, contentOffsetY: number;

    if (contentAspect > cssAspect) {
        contentW = cssW;
        contentH = cssW / contentAspect;
        contentOffsetX = 0;
        contentOffsetY = (cssH - contentH) / 2;
    } else {
        contentH = cssH;
        contentW = cssH * contentAspect;
        contentOffsetX = (cssW - contentW) / 2;
        contentOffsetY = 0;
    }

    return {
        left: canvasRect.left + contentOffsetX - parentRect.left,
        top: canvasRect.top + contentOffsetY - parentRect.top,
        width: contentW,
        height: contentH,
    };
}

const CameraBooth: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const bufferRef = useRef<HTMLCanvasElement | null>(null);
    const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const animationFrameRef = useRef<number>();
    const tickRef = useRef(0);

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [faceBounds, setFaceBounds] = useState<FaceBounds[]>([]);
    const [drawingRect, setDrawingRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
    const [canvasBounds, setCanvasBounds] = useState<CanvasBounds | null>(null);
    
    const { setAppMode, isDrawingRegion, setIsDrawingRegion, activeRegionId, setActiveRegionId } = useUIStore();
    const { addMedia, effects, regions, addRegion } = useProjectStore();

    const updateCanvasBounds = useCallback(() => {
        if (!canvasRef.current || !containerRef.current) return;
        setCanvasBounds(getCanvasContentBounds(canvasRef.current, containerRef.current));
    }, []);

    useEffect(() => {
        async function setupCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 1280, height: 720 },
                    audio: false
                });
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
                
                const buffer = document.createElement("canvas");
                bufferRef.current = buffer;
                bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });

            } catch (err) {
                console.error("Error accessing camera:", err);
                alert("Could not access camera");
                setAppMode("home");
            }
        }

        setupCamera();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    useEffect(() => {
        updateCanvasBounds();

        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(updateCanvasBounds);
        observer.observe(container);

        return () => observer.disconnect();
    }, [updateCanvasBounds]);

    useEffect(() => {
        const render = async () => {
            if (!videoRef.current || !canvasRef.current || !bufferRef.current || !bufferCtxRef.current) {
                animationFrameRef.current = requestAnimationFrame(render);
                return;
            }

            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");

            if (video.readyState === video.HAVE_ENOUGH_DATA && ctx && video.videoWidth > 0 && video.videoHeight > 0) {
                 if (canvas.width !== video.videoWidth) {
                     canvas.width = video.videoWidth;
                     canvas.height = video.videoHeight;
                     updateCanvasBounds();
                 }

                 if (tickRef.current % 10 === 0) {
                     try {
                         const faces = await detectFaces(video);
                         setFaceBounds(faces);
                     } catch (error) {
                         console.error("Face detection failed:", error);
                     }
                 }
                 
                 ctx.save();
                 ctx.translate(canvas.width, 0);
                 ctx.scale(-1, 1);
                 
                 renderWithEffects(
                    {
                        ctx,
                        buffer: bufferRef.current,
                        bufferCtx: bufferCtxRef.current!,
                        source: video,
                        sourceWidth: video.videoWidth,
                        sourceHeight: video.videoHeight,
                        canvasWidth: canvas.width,
                        canvasHeight: canvas.height,
                        tick: tickRef.current,
                        faceBounds
                    },
                    effects.filter(e => e.active),
                    regions
                 );
                 
                 ctx.restore();
                 
                 tickRef.current++;
            }

            animationFrameRef.current = requestAnimationFrame(render);
        };

        render();
        
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, [stream, effects, faceBounds, regions, updateCanvasBounds]);

    const handleBack = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setAppMode("home");
    };

    const takePhoto = () => {
        if (!canvasRef.current) return;
        
        const canvas = canvasRef.current;
        const dataUrl = canvas.toDataURL("image/png");
            
        const newMedia = {
            id: `capture-${Date.now()}`,
            type: "image" as const,
            name: `Capture ${new Date().toLocaleTimeString()}`,
            path: dataUrl 
        };
        
        addMedia(newMedia);
        setAppMode("editor");
    };

    const mouseToNormalized = (clientX: number, clientY: number) => {
        if (!canvasBounds || !containerRef.current) return null;
        
        const parentRect = containerRef.current.getBoundingClientRect();
        const x = clientX - parentRect.left - canvasBounds.left;
        const y = clientY - parentRect.top - canvasBounds.top;
        
        const normalizedX = Math.max(0, Math.min(1, x / canvasBounds.width));
        const normalizedY = Math.max(0, Math.min(1, y / canvasBounds.height));
        
        return { x: normalizedX, y: normalizedY };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!isDrawingRegion) return;
        
        const normalized = mouseToNormalized(e.clientX, e.clientY);
        if (normalized) {
            setStartPoint(normalized);
            setDrawingRect({ x: normalized.x, y: normalized.y, width: 0, height: 0 });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDrawingRegion || !startPoint) return;
        
        const normalized = mouseToNormalized(e.clientX, e.clientY);
        if (normalized) {
            const x = Math.min(startPoint.x, normalized.x);
            const y = Math.min(startPoint.y, normalized.y);
            const w = Math.abs(normalized.x - startPoint.x);
            const h = Math.abs(normalized.y - startPoint.y);
            
            setDrawingRect({ x, y, width: w, height: h });
        }
    };

    const handleMouseUp = () => {
        if (!isDrawingRegion || !startPoint || !drawingRect) return;
        
        if (drawingRect.width > 0.02 && drawingRect.height > 0.02) {
            const regionNumber = regions.length + 1;
            const colorIndex = regions.length % REGION_COLORS.length;
            
            const flippedX = 1 - drawingRect.x - drawingRect.width;
            
            const newRegion: Region = {
                id: `region-${Date.now()}`,
                name: `Region ${regionNumber}`,
                color: REGION_COLORS[colorIndex],
                x: flippedX,
                y: drawingRect.y,
                width: drawingRect.width,
                height: drawingRect.height,
            };
            addRegion(newRegion);
            setActiveRegionId(newRegion.id);
            setIsDrawingRegion(false);
        }
        
        setStartPoint(null);
        setDrawingRect(null);
    };

    const handleRegionClick = (regionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setActiveRegionId(regionId);
    };

    return (
        <div className={styles.booth} ref={containerRef}>
            <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            <canvas ref={canvasRef} className={styles.canvas} />
            
            <div 
                className={`${styles.overlay} ${isDrawingRegion ? styles.drawing : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                style={canvasBounds ? {
                    left: canvasBounds.left,
                    top: canvasBounds.top,
                    width: canvasBounds.width,
                    height: canvasBounds.height,
                } : undefined}
            >
                {regions.map((region) => {
                    const unflippedX = 1 - region.x - region.width;
                    return (
                        <div
                            key={region.id}
                            className={`${styles.region} ${activeRegionId === region.id ? styles.active : ''}`}
                            style={{
                                left: `${unflippedX * 100}%`,
                                top: `${region.y * 100}%`,
                                width: `${region.width * 100}%`,
                                height: `${region.height * 100}%`,
                                borderColor: region.color,
                            }}
                            onClick={(e) => handleRegionClick(region.id, e)}
                        >
                            <div className={styles.regionLabel} style={{ color: region.color }}>
                                {region.name}
                            </div>
                        </div>
                    );
                })}
                {drawingRect && (
                    <div
                        className={styles.drawingRect}
                        style={{
                            left: `${drawingRect.x * 100}%`,
                            top: `${drawingRect.y * 100}%`,
                            width: `${drawingRect.width * 100}%`,
                            height: `${drawingRect.height * 100}%`,
                        }}
                    />
                )}
            </div>
            
            <div className={styles.uiLayer}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={handleBack}>
                        <ArrowLeft size={20} /> Back
                    </button>
                    <span>CAMERA BOOTH</span>
                    <div style={{width: 60}}></div>
                </div>

                <div className={styles.controls}>
                    <div className={styles.shutter} onClick={takePhoto}></div>
                </div>
            </div>
        </div>
    );
};

export default CameraBooth;
