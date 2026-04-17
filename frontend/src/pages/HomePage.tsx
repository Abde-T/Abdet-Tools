import React from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Scissors, Sparkles, Zap, Layout, Play, Clock } from "lucide-react";

const HomePage = () => {
  const tools = [
    {
      title: "Timeline Editor",
      description: "A professional-grade video editing timeline with multi-track support, transitions, and real-time preview.",
      icon: <TimelineIcon />,
      link: "/timeline",
      color: "from-indigo-500 to-purple-600",
      tag: "Pro Tool"
    },
    {
      title: "Future Tool",
      description: "More powerful tools are coming soon to the Abde-T suite. Stay tuned for AI-powered video analysis.",
      icon: <Zap className="w-8 h-8 text-amber-400" />,
      link: "#",
      color: "from-slate-700 to-slate-900",
      tag: "Soon"
    }
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-white overflow-hidden selection:bg-indigo-500/30">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[1000px] overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-200px] left-[-100px] w-[600px] h-[600px] bg-indigo-600/20 blur-[120px] rounded-full" />
        <div className="absolute top-[100px] right-[-100px] w-[500px] h-[500px] bg-purple-600/10 blur-[120px] rounded-full" />
      </div>

      <main className="max-w-7xl mx-auto px-6 pt-12 pb-24 relative">
        {/* Hero Section */}
        <div className="text-center mb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-indigo-300 mb-6">
              <Sparkles className="w-4 h-4" />
              Revolutionizing Creative Workflows
            </span>
            <h1 className="text-6xl md:text-8xl font-black tracking-tight mb-8 bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
              Abde-T <br />
              <span className="text-indigo-500 italic">Tools.</span>
            </h1>
            <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Experience the next generation of creative tools. Fast, intuitive, and built for professionals who want to push the boundaries of what's possible.
            </p>
          </motion.div>
        </div>

        {/* Tools Grid */}
        <div className="grid md:grid-cols-2 gap-8">
          {tools.map((tool, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: index * 0.1 }}
            >
              <Link 
                to={tool.link}
                className="group relative block h-full p-8 rounded-[32px] bg-white/5 border border-white/10 hover:border-white/20 transition-all duration-300 overflow-hidden"
              >
                {/* Glow Effect on Hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${tool.color} opacity-0 group-hover:opacity-10 transition-opacity duration-500`} />
                
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-12">
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/10 group-hover:scale-110 transition-transform duration-300">
                      {tool.icon}
                    </div>
                    <span className="px-3 py-1 rounded-full bg-white/5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border border-white/5">
                      {tool.tag}
                    </span>
                  </div>

                  <h3 className="text-3xl font-bold mb-4 group-hover:text-indigo-400 transition-colors">
                    {tool.title}
                  </h3>
                  <p className="text-zinc-400 leading-relaxed mb-8">
                    {tool.description}
                  </p>

                  <div className="flex items-center gap-2 text-sm font-bold text-zinc-300 group-hover:text-white transition-colors">
                    Explore Tool
                    <motion.span
                      animate={{ x: [0, 4, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                    >
                      →
                    </motion.span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </main>

      {/* Footer / Info */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5 text-center text-zinc-500 text-sm">
        <p>© {new Date().getFullYear()} AbdeT. All rights reserved.</p>
      </footer>
    </div>
  );
};

// Custom Icon for Timeline
const TimelineIcon = () => (
  <div className="w-8 h-8 flex flex-col gap-1 justify-center">
    <div className="h-1.5 w-full bg-indigo-500 rounded-full" />
    <div className="h-1.5 w-[60%] bg-white/40 rounded-full" />
    <div className="h-1.5 w-[80%] bg-white/20 rounded-full" />
  </div>
);

export default HomePage;
