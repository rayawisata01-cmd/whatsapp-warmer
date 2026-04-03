# Replit Nix Configuration
# Defines the system packages available in the environment

{ pkgs }: {
  # Required packages
  deps = [
    # Node.js - Required for Baileys (WhatsApp service)
    pkgs.nodejs-18_x
    pkgs.nodePackages.npm
    
    # Bun - For Next.js
    pkgs.bun
    
    # SQLite - For database
    pkgs.sqlite
    
    # Git - For npm dependencies
    pkgs.git
    
    # Python - Sometimes needed for native modules
    pkgs.python3
    
    # Build tools
    pkgs.gcc
    pkgs.gnumake
    
    # Process management
    pkgs.process-compose
  ];
  
  # Environment variables
  env = {
    NODE_ENV = "production";
    HOSTNAME = "0.0.0.0";
    # Chrome for Baileys (optional, for some features)
    CHROME_BIN = "${pkgs.chromium}/bin/chromium";
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = "true";
  };
}
