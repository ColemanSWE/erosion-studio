import React, { useRef, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import styles from "./CameraBooth.module.scss";
import { useUIStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { renderWithEffects } from "../../lib/effects/effects-renderer";

const CameraBooth: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bufferRef = useRef<HTMLCanvasElement | null>(null);
    const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
    const animationFrameRef = useRef<number>();
    const tickRef = useRef(0);

    const [stream, setStream] = useState<MediaStream | null>(null);
    const { setAppMode } = useUIStore();
    const { addMedia, selectMedia, effects } = useProjectStore();

    // Setup Camera
    useEffect(() => {
        async function setupCamera() {
            try {
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 1280, height: 720 }, // 720p default
                    audio: false // No audio for now
                });
                setStream(mediaStream);
                if (videoRef.current) {
                    videoRef.current.srcObject = mediaStream;
                }
                
                // Initialize buffer
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

    // Render loop
    useEffect(() => {
        const render = () => {
            if (!videoRef.current || !canvasRef.current || !bufferRef.current || !bufferCtxRef.current) {
                animationFrameRef.current = requestAnimationFrame(render);
                return;
            }

            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");

            if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
                 if (canvas.width !== video.videoWidth) {
                     canvas.width = video.videoWidth;
                     canvas.height = video.videoHeight;
                 }

                 // We want to mirror the INPUT so the user sees themselves like a mirror
                 // But `renderWithEffects` draws the source.
                 // We can flip the source in the buffer step?
                 // Or we can flip the final canvas context?
                 // Let's flip the final canvas context before drawing.
                 
                 ctx.save();
                 ctx.translate(canvas.width, 0);
                 ctx.scale(-1, 1);
                 
                 // Actually `renderWithEffects` does its own clearing and drawing.
                 // If we flip context, we need to make sure `renderWithEffects` respects it.
                 // `renderWithEffects` calls `ctx.drawImage`. 
                 // So if we set transform on `ctx`, it should apply.
                 
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
                        tick: tickRef.current
                    },
                    effects.filter(e => e.active)
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
    }, [stream, effects]);

    const handleBack = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setAppMode("home");
    };

    const takePhoto = () => {
        if (!canvasRef.current) return;
        
        const canvas = canvasRef.current;
        
        // The canvas already has the effects and is mirrored (visually).
        // But `toDataURL` extracts the underlying pixel data.
        // If we used `ctx.scale(-1, 1)`, the drawing was flipped.
        // So the underlying pixels ARE flipped? 
        // No, standard canvas `scale` transforms the coordinate system for drawing commands.
        // If we drew the image flipped, the pixels in the buffer are flipped.
        // So `toDataURL` should return the flipped image (what we see).
        
        const dataUrl = canvas.toDataURL("image/png");
            
            // We need to actually write this to disk for ffmpeg/other tools to use it potentially?
            // Or can we just use Data URL? 
            // `usePhotoEditor` draws images to canvas. `ctx.drawImage` works with Data URLs.
            // So for Photo Editing it should be fine.
            
            const newMedia = {
                id: `capture-${Date.now()}`,
                type: "image" as const,
                name: `Capture ${new Date().toLocaleTimeString()}`,
                path: dataUrl 
            };
            
            addMedia(newMedia);
            
            // We need a way to SELECT this media immediately.
            // But `addMedia` doesn't return the ID clearly (it does here since we generated it).
            // We need to update the store to select it.
            // Note: `useProjectStore` doesn't export `selectMedia` in the interface shown previously?
            // Let's check `App.tsx`... yes it does: `selectMedia`.
            
                setAppMode("editor");
        // }); remove the blob logic, we use sync dataUrl
    };

    return (
        <div className={styles.booth}>
            {/* Hidden source video */}
            <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />
            {/* Display canvas */}
            <canvas ref={canvasRef} className={styles.canvas} />
            
            <div className={styles.uiLayer}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={handleBack}>
                        <ArrowLeft size={20} /> Back
                    </button>
                    <span>CAMERA BOOTH</span>
                    <div style={{width: 60}}></div> {/* Spacer */}
                </div>

                <div className={styles.controls}>
                    <div className={styles.shutter} onClick={takePhoto}></div>
                </div>
            </div>
        </div>
    );
};

export default CameraBooth;
