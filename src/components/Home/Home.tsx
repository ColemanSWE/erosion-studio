import React from "react";
import { Camera, Image, Film } from "lucide-react";
import styles from "./Home.module.scss";
import { useUIStore } from "../../stores/uiStore";

interface HomeProps {
  onImport: (type: "image" | "video") => Promise<void>;
}

const Home: React.FC<HomeProps> = ({ onImport }) => {
  const { setAppMode } = useUIStore();

  const handlePhotoClick = async () => {
    // Show timeline explicitly false for photo mode?
    // The store currently only has toggle. We might need a direct setter later.
    // For now we assume default is 'true' or we manage it in the parent.
    await onImport("image");
    setAppMode("editor");
  };

  const handleVideoClick = async () => {
    await onImport("video");
    setAppMode("editor");
  };

  const handleCameraClick = () => {
    setAppMode("camera");
  };

  return (
    <div className={styles.home}>
      <h1>Erosion Studio</h1>
      
      <div className={styles.grid}>
        <div className={styles.card} onClick={handlePhotoClick}>
          <Image size={64} className={styles.icon} />
          <span className={styles.label}>Photo</span>
        </div>

        <div className={styles.card} onClick={handleVideoClick}>
          <Film size={64} className={styles.icon} />
          <span className={styles.label}>Video</span>
        </div>

        <div className={styles.card} onClick={handleCameraClick}>
          <Camera size={64} className={styles.icon} />
          <span className={styles.label}>Camera</span>
        </div>
      </div>
    </div>
  );
};

export default Home;
