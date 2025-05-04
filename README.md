# Minecraft Docker Admin Panel

This project provides a web-based administration panel specifically designed for managing Minecraft servers running within Docker containers.

## Server Configuration

Servers are managed via a Docker Compose file. Define each Minecraft server instance as a service within your `docker-compose.yml`. You can use the provided `compose.example.yml` as a starting point for your configuration. The panel will automatically detect and display all Minecraft server services defined in the compose file.

## Features

*   **Real-time TPS:** Displays live Ticks Per Second (TPS) data for your servers. *Requires the [Spark](https://spark.lucko.me/) mod/plugin to be installed on the Minecraft server.*
*   **Resource Monitoring:** Shows the current CPU and Memory usage for each server container.
*   **Interactive Console:** Allows direct interaction with the Minecraft server console through the web interface.
*   **Multi-Server Support:** Seamlessly handles any number of Minecraft servers defined in your Docker Compose file.
*   **TODO: Discord Relay:** Includes an optional Discord relay bot that bridges chat between your Minecraft server and a specified Discord channel without requiring any server-side mods or plugins.

## Access & Security

**Important:** This panel does not include built-in user authentication or access control. It is strongly recommended **not** to expose the panel directly to the internet.

If you need remote access, ensure you place it behind a secure authentication proxy or service, such as Cloudflare Zero Trust, Authelia, or similar solutions.

## Development

For development and building purposes, a `compose.dev.example.yml` file is provided as a starting point for a development-friendly setup.