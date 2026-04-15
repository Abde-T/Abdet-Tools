import React, {
  useEffect,
  useRef,
  memo,
  useState,
  useMemo,
  useCallback,
} from "react";
import { Rect, Group, Image as KonvaImage } from "react-konva";

/**
 * ImagePreview.tsx
 *
 * Renders an image clip on the timeline canvas.
 * Can tile (repeat) the image horizontally across the clip width
 * or stretch it depending on the `repeatX` prop.
 */
interface ImagePreviewProps {
  imageUrl: string | File | Blob;
  width: number;
  height: number;
  x?: number;
  y?: number;
  repeatX?: boolean;
}

const ImagePreview: React.FC<ImagePreviewProps> = ({
  imageUrl,
  width,
  height,
  x = 0,
  y = 0,
  repeatX = true,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const loadImage = useCallback(
    (url: string) => {
      if (!url || width < 5) return; // Allow smaller clips

      // Clean up previous image loading
      if (imageRef.current) {
        imageRef.current.onload = null;
        imageRef.current.onerror = null;
      }

      setIsLoading(true);

      const isLocal =
        url.startsWith("blob:") ||
        url.startsWith("data:") ||
        url.startsWith("file:");

      const fetchUrl = isLocal
        ? url
        : url.includes("?")
        ? `${url}&preview=1`
        : `${url}?preview=1`;

      const img = new Image();
      if (!isLocal) {
        img.crossOrigin = "anonymous";
      }
      img.onload = () => {
        setImage(img);
        setImageWidth(img.naturalWidth);
        setImageHeight(img.naturalHeight);
        setIsLoading(false);
      };
      img.onerror = () => {
        console.error("Failed to load image preview:", url);
        setIsLoading(false);
        setImage(null);
      };
      img.src = fetchUrl;
      imageRef.current = img;

      return () => {
        img.onload = null;
        img.onerror = null;
      };
    },
    [width]
  );

  useEffect(() => {
    let internalUrl = "";
    if (imageUrl instanceof File || imageUrl instanceof Blob) {
      internalUrl = URL.createObjectURL(imageUrl);
    } else {
      internalUrl = imageUrl;
    }

    const cleanup = loadImage(internalUrl);

    return () => {
      if (cleanup) cleanup();
      if (imageUrl instanceof File || imageUrl instanceof Blob) {
        URL.revokeObjectURL(internalUrl);
      }
    };
  }, [imageUrl, loadImage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (imageRef.current) {
        imageRef.current.onload = null;
        imageRef.current.onerror = null;
      }
    };
  }, []);

  // Memoize image tiles calculation
  const imageTiles = useMemo(() => {
    if (!image || !imageWidth || !imageHeight || isLoading) {
      // Render a placeholder background if loading or failed
      return (
        <Rect
          x={x}
          y={y + 5}
          width={width}
          height={height - 10}
          fill="rgba(255, 255, 255, 0.05)"
          cornerRadius={8}
        />
      );
    }

    const aspectRatio = imageWidth / imageHeight;
    const tileHeight = height - 10;
    const tileWidth = tileHeight * aspectRatio;

    if (repeatX) {
      const spacing = 4; // Better spacing
      const tileWidthWithSpacing = tileWidth + spacing;
      const numTiles = Math.ceil(width / tileWidthWithSpacing) + 1;

      return Array.from({ length: numTiles }, (_, i) => (
        <KonvaImage
          key={i}
          x={x + i * tileWidthWithSpacing}
          y={y + 5}
          width={tileWidth}
          height={tileHeight}
          image={image}
          cornerRadius={4}
          crop={{
            x: 0,
            y: 0,
            width: imageWidth,
            height: imageHeight,
          }}
        />
      ));
    }

    return (
      <KonvaImage
        x={x}
        y={y + 5}
        width={width}
        height={tileHeight}
        image={image}
        cornerRadius={4}
        crop={{
          x: 0,
          y: 0,
          width: imageWidth,
          height: imageHeight,
        }}
      />
    );
  }, [image, imageWidth, imageHeight, width, height, x, y, repeatX, isLoading]);

  return (
    <Group clipX={x} clipY={y} clipWidth={width} clipHeight={height}>
      {imageTiles}
    </Group>
  );
};

ImagePreview.displayName = "ImagePreview";

// Custom comparison function to prevent unnecessary re-renders
const areEqual = (
  prevProps: ImagePreviewProps,
  nextProps: ImagePreviewProps
) => {
  return (
    prevProps.imageUrl === nextProps.imageUrl &&
    prevProps.width === nextProps.width &&
    prevProps.height === nextProps.height &&
    prevProps.x === nextProps.x &&
    prevProps.y === nextProps.y &&
    prevProps.repeatX === nextProps.repeatX
  );
};

export default memo(ImagePreview, areEqual);
