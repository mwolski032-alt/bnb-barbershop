"use client";

import { useState } from "react";

type ProfileAvatarProps = {
  className: string;
  name: string;
  photoUrl?: string | null;
  alt?: string;
};

export default function ProfileAvatar({
  className,
  name,
  photoUrl,
  alt = "",
}: ProfileAvatarProps) {
  const [failedPhotoUrl, setFailedPhotoUrl] = useState("");
  const normalizedPhotoUrl = photoUrl?.trim() ?? "";
  const showPhoto = Boolean(normalizedPhotoUrl && failedPhotoUrl !== normalizedPhotoUrl);
  const initial = name.trim().slice(0, 1).toLocaleUpperCase("pl") || "?";

  return (
    <span className={`profile-avatar ${className}`}>
      {showPhoto ? (
        <img
          src={normalizedPhotoUrl}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedPhotoUrl(normalizedPhotoUrl)}
        />
      ) : (
        <span className="profile-avatar-fallback" aria-hidden={alt ? undefined : true}>
          {initial}
        </span>
      )}
    </span>
  );
}
