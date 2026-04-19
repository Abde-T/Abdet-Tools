import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Sparkles,
  Zap,
  Search,
  Video,
  Image as ImageIcon,
  Music,
  Terminal,
  ArrowRight,
  Layers,
  LayoutTemplate,
  Palette,
} from "lucide-react";

const HomePage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const categories = ["All", "Video", "Image", "Audio", "Utility"];

  const tools = [
    {
      title: "Timeline Editor",
      description:
        "Professional-grade multi-track video editing timeline with real-time preview, transitions, and keyframing.",
      icon: <Video className="w-6 h-6" />,
      link: "/timeline",
      color: "from-blue-500 to-indigo-600",
      tag: "Video",
      featured: true,
      status: "Active",
    },
    {
      title: "Coming Soon",
      description: "",
      icon: <ImageIcon className="w-6 h-6" />,
      link: "#",
      color: "from-emerald-400 to-teal-600",
      tag: "Image",
      featured: false,
      status: "Coming Soon",
    },
    {
      title: "Coming Soon",
      description: "",
      icon: <ImageIcon className="w-6 h-6" />,
      link: "#",
      color: "from-emerald-400 to-teal-600",
      tag: "Image",
      featured: false,
      status: "Coming Soon",
    },
    {
      title: "Coming Soon",
      description: "",
      icon: <ImageIcon className="w-6 h-6" />,
      link: "#",
      color: "from-emerald-400 to-teal-600",
      tag: "Image",
      featured: false,
      status: "Coming Soon",
    },
    {
      title: "Coming Soon",
      description: "",
      icon: <ImageIcon className="w-6 h-6" />,
      link: "#",
      color: "from-emerald-400 to-teal-600",
      tag: "Image",
      featured: false,
      status: "Coming Soon",
    },
    {
      title: "Coming Soon",
      description: "",
      icon: <ImageIcon className="w-6 h-6" />,
      link: "#",
      color: "from-emerald-400 to-teal-600",
      tag: "Image",
      featured: false,
      status: "Coming Soon",
    },
  ];

  const filteredTools = tools.filter((tool) => {
    const matchesSearch =
      tool.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      activeCategory === "All" || tool.tag === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-indigo-500/30 font-sans">
      {/* Dynamic Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[150px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[150px] rounded-full mix-blend-screen" />
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPgo8cmVjdCB3aWR0aD0iOCIgaGVpZ2h0PSI4IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDUiLz4KPC9zdmc+')] opacity-20" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-black/20 backdrop-blur-xl sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <LayoutTemplate className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Abde Tiamani
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-16 pb-32 relative z-10">
        {/* Hero Section */}
        <div className="mb-20 grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-sm font-medium text-indigo-400 mb-6">
              <Sparkles className="w-4 h-4" />
              v2.0 is now live
            </div>
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-[1.1]">
              The Ultimate <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                Toolkit for Creators.
              </span>
            </h1>
          </motion.div>

          {/* Featured Tool Card */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="hidden lg:block relative group perspective-1000"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/30 to-purple-600/30 blur-3xl -z-10 rounded-[3rem] group-hover:opacity-70 transition-opacity duration-700" />
            <Link
              to="/timeline"
              className="block relative bg-zinc-900/50 backdrop-blur-2xl border border-white/10 p-8 rounded-[2.5rem] overflow-hidden transform transition-all duration-500 hover:rotate-y-[-5deg] hover:rotate-x-[5deg] hover:scale-[1.02]"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 blur-[80px] rounded-full pointer-events-none" />

              <div className="flex justify-between items-start mb-12 relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-4 shadow-xl shadow-indigo-500/20">
                  <Video className="w-full h-full text-white" />
                </div>
                <div className="px-4 py-1.5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold uppercase tracking-widest border border-indigo-500/30">
                  Featured
                </div>
              </div>

              <div className="relative z-10">
                <h3 className="text-3xl font-black mb-4">Timeline Editor</h3>
                <p className="text-zinc-400 text-lg leading-relaxed mb-8">
                  A professional, multi-track timeline component built for the
                  modern web. Smooth zooming, snapping, and precise keyframing.
                </p>
                <div className="flex items-center gap-2 text-indigo-400 font-bold group-hover:text-indigo-300 transition-colors">
                  Open Application{" "}
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform" />
                </div>
              </div>
            </Link>
          </motion.div>
        </div>

        {/* Tools Library Section */}
        <div className="mb-12 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold mb-2">Tools Library</h2>
            <p className="text-zinc-500">
              Explore our collection of creative utilities.
            </p>
          </div>
        </div>

        {/* Grid */}
        <motion.div layout className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence>
            {filteredTools.map((tool, index) => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
                key={tool.title}
              >
                {tool.status === "Active" ? (
                  <Link
                    to={tool.link}
                    className="group block h-full p-6 rounded-3xl bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all duration-300 relative overflow-hidden"
                  >
                    <div
                      className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-10 blur-2xl transition-opacity duration-500 rounded-full`}
                    />

                    <div className="flex justify-between items-start mb-6">
                      <div
                        className={`p-3 rounded-xl bg-gradient-to-br ${tool.color} shadow-lg group-hover:scale-110 transition-transform duration-300`}
                      >
                        <div className="text-white drop-shadow-md">
                          {React.cloneElement(
                            tool.icon as React.ReactElement<{
                              className?: string;
                            }>,
                            { className: "w-5 h-5" },
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        {tool.featured && (
                          <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-[10px] font-bold uppercase tracking-wider text-indigo-300 border border-indigo-500/20">
                            Featured
                          </span>
                        )}
                      </div>
                    </div>

                    <h3 className="text-xl font-bold mb-2 group-hover:text-white text-zinc-100 transition-colors">
                      {tool.title}
                    </h3>
                    <p className="text-sm text-zinc-500 leading-relaxed mb-6">
                      {tool.description}
                    </p>

                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-xs font-semibold text-zinc-600 bg-black/30 px-3 py-1 rounded-full border border-white/5">
                        {tool.tag}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white text-zinc-400 transition-colors">
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div className="h-full p-6 rounded-3xl bg-black/20 border border-white/5 relative overflow-hidden cursor-not-allowed group">
                    <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0IiBoZWlnaHQ9IjQiPgo8cmVjdCB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjZmZmIiBmaWxsLW9wYWNpdHk9IjAuMDIiLz4KPC9zdmc+')] z-0 pointer-events-none" />

                    <div className="relative z-10 flex justify-between items-start mb-6 grayscale opacity-50 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500">
                      <div
                        className={`p-3 rounded-xl bg-gradient-to-br ${tool.color}`}
                      >
                        <div className="text-white">
                          {React.cloneElement(
                            tool.icon as React.ReactElement<{
                              className?: string;
                            }>,
                            { className: "w-5 h-5" },
                          )}
                        </div>
                      </div>

                      <span className="px-2.5 py-1 rounded-full bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400 border border-zinc-700">
                        {tool.status}
                      </span>
                    </div>

                    <h3 className="text-xl font-bold mb-2 text-zinc-400 relative z-10">
                      {tool.title}
                    </h3>
                    <p className="text-sm text-zinc-600 leading-relaxed mb-6 relative z-10">
                      {tool.description}
                    </p>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredTools.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full py-20 text-center"
            >
              <div className="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-full flex items-center justify-center text-zinc-500">
                <Search className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-zinc-300 mb-2">
                No tools found
              </h3>
              <p className="text-zinc-500">
                Try adjusting your search or filter criteria.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("All");
                }}
                className="mt-6 px-4 py-2 bg-white/10 hover:bg-white/20 text-sm font-medium rounded-full transition-colors"
              >
                Clear Filters
              </button>
            </motion.div>
          )}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black/40 relative z-10">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-5 h-5 text-indigo-400" />
            <span className="font-bold text-zinc-300">Abde Tiamani Tools</span>
          </div>
          <div className="text-zinc-500 text-sm">
            © {new Date().getFullYear()} Abde Tiamani. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default HomePage;
