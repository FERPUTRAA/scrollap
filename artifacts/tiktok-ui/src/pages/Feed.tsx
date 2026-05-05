import React from "react";
import { MOCK_VIDEOS } from "../data/mock";
import VideoCard from "../components/VideoCard";

export default function Feed() {
  return (
    <div className="relative h-full w-full bg-black">
      {/* Top Navigation Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 flex justify-between items-center px-4 pt-12 pb-4 pointer-events-none">
        <div className="flex-1"></div>
        <div className="flex gap-4 items-center justify-center font-bold text-lg drop-shadow-md pointer-events-auto">
          <span className="text-white/60 cursor-pointer">Following</span>
          <span className="text-white cursor-pointer relative">
            For You
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-white rounded-full"></div>
          </span>
        </div>
        <div className="flex-1 flex justify-end pointer-events-auto text-xl">
          {/* Mock Search Icon */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
      </div>

      {/* Video Feed scroll container */}
      <div 
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory no-scrollbar"
        style={{ scrollBehavior: 'smooth' }}
      >
        {MOCK_VIDEOS.map((video) => (
          <div key={video.id} className="snap-start snap-always h-full w-full relative">
            <VideoCard video={video} />
          </div>
        ))}
      </div>
    </div>
  );
}
