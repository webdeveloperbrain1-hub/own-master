import { useState, useEffect } from 'react';

export default function App() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: '',
    link: '',
    message: ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', formData);
    alert('Thank you for your interest! We\'ll be in touch soon.');
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');

            // Animate children with stagger effect
            const children = entry.target.querySelectorAll('.stagger-item');
            children.forEach((child, index) => {
              setTimeout(() => {
                child.classList.add('animate-in');
              }, index * 100);
            });
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('.fade-in-section').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <style>{`
        .fade-in-section {
          opacity: 0;
          transform: translateY(30px);
          transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        }
        .fade-in-section.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
        .stagger-item {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        }
        .stagger-item.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
        .hover-lift {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .hover-lift:hover {
          transform: translateY(-4px);
        }
        .hover-scale {
          transition: transform 0.2s ease;
        }
        .hover-scale:hover {
          transform: scale(1.05);
        }
        .slide-in-left {
          opacity: 0;
          transform: translateX(-30px);
          transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        }
        .slide-in-left.animate-in {
          opacity: 1;
          transform: translateX(0);
        }
        .slide-in-right {
          opacity: 0;
          transform: translateX(30px);
          transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        }
        .slide-in-right.animate-in {
          opacity: 1;
          transform: translateX(0);
        }
      `}</style>
      <div className="max-w-[1120px] mx-auto px-[18px] pb-16">
        {/* Header */}
        <header className="flex justify-between items-center py-[18px] border-b border-border">
          <div className="font-[850] tracking-[-0.3px] text-[18px]">Own Masters</div>
          <div className="flex gap-6 items-center">
            <button
              onClick={() => scrollToSection('home')}
              className="text-foreground cursor-pointer hover:opacity-70 transition-opacity hidden md:block bg-transparent border-0 p-0"
            >
              Home
            </button>
            <button
              onClick={() => scrollToSection('about')}
              className="text-foreground cursor-pointer hover:opacity-70 transition-opacity hidden md:block bg-transparent border-0 p-0"
            >
              About
            </button>
            <button
              onClick={() => scrollToSection('how-it-works')}
              className="text-foreground cursor-pointer hover:opacity-70 transition-opacity hidden md:block bg-transparent border-0 p-0"
            >
              How it Works
            </button>
            <button
              onClick={() => scrollToSection('waitlist')}
              className="border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 transition-all hover:scale-105"
            >
              Join Waitlist
            </button>
          </div>
        </header>

        {/* Hero Section */}
        <section id="home" className="py-[72px] md:py-[44px] grid md:grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-7 items-center fade-in-section">
          <div>
            <h1 className="m-0 mb-[14px] text-[clamp(38px,6vw,68px)] leading-[1.02] tracking-[-1.4px]">
              Build your music business before the industry builds it for you.
            </h1>
            <p className="text-muted-foreground text-[18px] leading-[1.5] max-w-[680px] m-0 mb-[22px]">
              Own Masters helps artists, managers, producers, DJs, and writers organize teams,
              protect songs, manage agreements, and access trusted industry experts.
            </p>

            <button
              onClick={() => scrollToSection('waitlist')}
              className="border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 transition-all hover:scale-105"
            >
              Request Early Access
            </button>
            <div className="text-[rgba(255,255,255,.50)] text-[13px] mt-3">
              For artists, managers, producers, DJs, writers, and music industry pros.
            </div>

            <div className="flex gap-[10px] flex-wrap mt-4">
              {['Artist', 'Manager', 'Producer', 'Writer', 'DJ', 'Industry Pro'].map((role) => (
                <span
                  key={role}
                  className="px-[13px] py-[10px] rounded-full border border-border bg-muted text-[rgba(255,255,255,.78)] font-[700] text-[14px]"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>

          <div className="border border-border bg-gradient-to-b from-[rgba(255,255,255,.08)] to-[rgba(255,255,255,.04)] rounded-[22px] p-[22px]">
            <h3 className="m-0 mb-3 text-[18px]">Your label command center</h3>

            <div className="flex justify-between items-center gap-3 p-3 rounded-[16px] border border-border bg-muted mt-[10px]">
              <div>
                <strong>Track Pipeline</strong><br/>
                <span className="text-muted-foreground text-[13px]">Splits, agreements, rights, release readiness</span>
              </div>
              <div className="px-[9px] py-[6px] rounded-full border border-[rgba(255,255,255,.12)] text-[rgba(255,255,255,.78)] text-[12px] whitespace-nowrap">
                Coming Soon
              </div>
            </div>

            <div className="flex justify-between items-center gap-3 p-3 rounded-[16px] border border-border bg-muted mt-[10px]">
              <div>
                <strong>Advisor Network</strong><br/>
                <span className="text-muted-foreground text-[13px]">Book managers, A&Rs, attorneys, publishers</span>
              </div>
              <div className="px-[9px] py-[6px] rounded-full border border-[rgba(255,255,255,.12)] text-[rgba(255,255,255,.78)] text-[12px] whitespace-nowrap">
                Early Access
              </div>
            </div>

            <div className="flex justify-between items-center gap-3 p-3 rounded-[16px] border border-border bg-muted mt-[10px]">
              <div>
                <strong>Team Workspace</strong><br/>
                <span className="text-muted-foreground text-[13px]">Add managers, writers, producers, collaborators</span>
              </div>
              <div className="px-[9px] py-[6px] rounded-full border border-[rgba(255,255,255,.12)] text-[rgba(255,255,255,.78)] text-[12px] whitespace-nowrap">
                Private Beta
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-[50px] fade-in-section">
          <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">What's coming first</h2>

          <div className="grid md:grid-cols-1 lg:grid-cols-2 gap-[14px]">
            {[
              {
                title: 'Team Management',
                description: 'Add managers, producers, writers, DJs, collaborators, and advisors.'
              },
              {
                title: 'Split & Agreement Tools',
                description: 'Create simple agreements before release so everyone knows their role.'
              },
              {
                title: 'Track & Catalog Dashboard',
                description: 'Organize songs, contributors, rights, files, and release status.'
              },
              {
                title: 'Advisor Marketplace',
                description: 'Book trusted music pros for 1:1 calls around deals, rights, and strategy.'
              },
              {
                title: 'Rights Organization',
                description: 'Prepare for ASCAP, BMI, publishing, and future royalty workflows.'
              },
              {
                title: 'Release Readiness',
                description: 'Know what needs to be done before your song goes live.'
              }
            ].map((feature) => (
              <div key={feature.title} className="border border-border bg-card rounded-[22px] p-5 hover-lift cursor-pointer stagger-item">
                <h3 className="m-0 mb-2 text-[18px] tracking-[-0.3px]">{feature.title}</h3>
                <p className="m-0 text-muted-foreground leading-[1.45] text-[15px]">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* For Who Section */}
        <section id="about" className="py-[50px] bg-gradient-to-b from-transparent via-[rgba(255,255,255,.02)] to-transparent fade-in-section">
          <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">Built for both sides of the music business</h2>

          <div className="grid md:grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="border border-border bg-card rounded-[20px] p-6 hover-lift cursor-pointer stagger-item">
              <h3 className="m-0 mb-3 text-[19px] tracking-tight">For Creators</h3>
              <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                Run your music like a business. Add collaborators, define splits,
                generate agreements, and keep your catalog organized.
              </p>
            </div>

            <div className="border border-border bg-card rounded-[20px] p-6 hover-lift cursor-pointer stagger-item">
              <h3 className="m-0 mb-3 text-[19px] tracking-tight">For Managers</h3>
              <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                Manage artists, teams, agreements, release checklists, and advisor needs
                from one structured workspace.
              </p>
            </div>

            <div className="border border-border bg-card rounded-[20px] p-6 hover-lift cursor-pointer stagger-item">
              <h3 className="m-0 mb-3 text-[19px] tracking-tight">For Industry Pros</h3>
              <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                Join the advisor network and get booked by serious artists, producers,
                DJs, writers, and managers.
              </p>
            </div>
          </div>
        </section>

        {/* What Own Masters Helps With */}
        <section className="py-[50px] fade-in-section">
          <div className="text-center max-w-[750px] mx-auto mb-12">
            <h2 className="m-0 mb-4 text-[32px] tracking-tight">What Own Masters helps with</h2>
            <p className="text-muted-foreground text-[16px] leading-[1.6]">
              We solve the chaos that comes with building a music business—messy splits, unclear agreements,
              scattered team communication, and no clear path to trusted advisors.
            </p>
          </div>

          <div className="grid md:grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="text-center group cursor-pointer stagger-item">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[rgba(255,255,255,.12)] to-[rgba(255,255,255,.06)] border border-border flex items-center justify-center transition-all group-hover:scale-110 group-hover:border-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h3 className="m-0 mb-2 text-[17px] tracking-tight">Organize your catalog</h3>
              <p className="m-0 text-muted-foreground leading-[1.5] text-[14px]">
                Track contributors, splits, and files in one place.
              </p>
            </div>

            <div className="text-center group cursor-pointer stagger-item">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[rgba(255,255,255,.12)] to-[rgba(255,255,255,.06)] border border-border flex items-center justify-center transition-all group-hover:scale-110 group-hover:border-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <h3 className="m-0 mb-2 text-[17px] tracking-tight">Protect your rights</h3>
              <p className="m-0 text-muted-foreground leading-[1.5] text-[14px]">
                Generate clear agreements before release.
              </p>
            </div>

            <div className="text-center group cursor-pointer stagger-item">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[rgba(255,255,255,.12)] to-[rgba(255,255,255,.06)] border border-border flex items-center justify-center transition-all group-hover:scale-110 group-hover:border-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <h3 className="m-0 mb-2 text-[17px] tracking-tight">Connect with pros</h3>
              <p className="m-0 text-muted-foreground leading-[1.5] text-[14px]">
                Book trusted attorneys, managers, and A&Rs.
              </p>
            </div>

            <div className="text-center group cursor-pointer stagger-item">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[rgba(255,255,255,.12)] to-[rgba(255,255,255,.06)] border border-border flex items-center justify-center transition-all group-hover:scale-110 group-hover:border-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <line x1="19" y1="8" x2="19" y2="14"></line>
                  <line x1="22" y1="11" x2="16" y2="11"></line>
                </svg>
              </div>
              <h3 className="m-0 mb-2 text-[17px] tracking-tight">Manage your team</h3>
              <p className="m-0 text-muted-foreground leading-[1.5] text-[14px]">
                Keep collaborators aligned on every project.
              </p>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-[50px] fade-in-section">
          <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">How it works</h2>

          <div className="max-w-[800px] mx-auto space-y-6">
            <div className="flex gap-6 items-start group cursor-pointer hover-lift stagger-item">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-b from-[rgba(255,255,255,.15)] to-[rgba(255,255,255,.08)] border border-border flex items-center justify-center font-bold text-[18px] transition-all group-hover:border-primary group-hover:scale-110">
                1
              </div>
              <div className="pt-2">
                <h3 className="m-0 mb-2 text-[19px] tracking-tight">Create your project</h3>
                <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                  Add your tracks, upload files, and invite your team—producers, writers, managers, and collaborators.
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start group cursor-pointer hover-lift stagger-item">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-b from-[rgba(255,255,255,.15)] to-[rgba(255,255,255,.08)] border border-border flex items-center justify-center font-bold text-[18px] transition-all group-hover:border-primary group-hover:scale-110">
                2
              </div>
              <div className="pt-2">
                <h3 className="m-0 mb-2 text-[19px] tracking-tight">Define roles & splits</h3>
                <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                  Set ownership percentages, define roles, and generate simple agreements everyone understands.
                </p>
              </div>
            </div>

            <div className="flex gap-6 items-start group cursor-pointer hover-lift stagger-item">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-b from-[rgba(255,255,255,.15)] to-[rgba(255,255,255,.08)] border border-border flex items-center justify-center font-bold text-[18px] transition-all group-hover:border-primary group-hover:scale-110">
                3
              </div>
              <div className="pt-2">
                <h3 className="m-0 mb-2 text-[19px] tracking-tight">Release with confidence</h3>
                <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">
                  Access your release checklist, book advisor calls if needed, and launch knowing your business is protected.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Waitlist Form Section */}
        <section className="py-[34px] fade-in-section" id="waitlist">
          <div className="border border-border bg-gradient-to-b from-[rgba(255,255,255,.08)] to-[rgba(255,255,255,.04)] rounded-[22px] p-[22px]">
            <h2 className="m-0 mb-4 text-[26px] tracking-[-0.5px]">Join the early access list.</h2>
            <p className="text-muted-foreground text-[18px] leading-[1.5] max-w-[680px] m-0 mb-[22px]">
              Tell us who you are and what you need. We're inviting early users, advisors,
              and partners as we build the first version.
            </p>

            <form onSubmit={handleSubmit} className="grid gap-3">
              <div className="grid md:grid-cols-1 lg:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                  required
                />
              </div>

              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                required
              >
                <option className="text-black" value="">What best describes you?</option>
                <option className="text-black" value="artist">Artist</option>
                <option className="text-black" value="manager">Manager</option>
                <option className="text-black" value="producer">Producer</option>
                <option className="text-black" value="writer">Writer</option>
                <option className="text-black" value="dj">DJ</option>
                <option className="text-black" value="attorney">Attorney</option>
                <option className="text-black" value="a&r">A&R</option>
                <option className="text-black" value="publisher">Publisher</option>
                <option className="text-black" value="marketing">Marketing / Distribution Pro</option>
                <option className="text-black" value="other">Other Industry Pro</option>
              </select>

              <input
                type="text"
                placeholder="Instagram, website, or company"
                value={formData.link}
                onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
              />

              <textarea
                placeholder="What are you trying to solve right now? Example: splits, agreements, release planning, finding advisors, managing artists..."
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] min-h-[110px] resize-y transition-all focus:border-primary focus:ring-1 focus:ring-primary"
              />

              <button
                type="submit"
                className="border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 transition-all hover:scale-101"
              >
                Request Early Access
              </button>
            </form>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-[rgba(255,255,255,.52)] pt-7 border-t border-border mt-9 text-[13px] flex justify-between gap-3 flex-wrap">
          <div>Own Masters — Be the label. Own the masters.</div>
          <div>Terms · Privacy · Contact</div>
        </footer>
      </div>
    </div>
  );
}