import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as fs from 'fs-extra'
import * as toml from 'toml'

export const PROD_CLOUD_BASE = "https://cloud.fermyon.com"

export function initFermyonClient(): FermyonClient {
    return new FermyonClient(PROD_CLOUD_BASE)
}

export class GetAppsResp {
    items: Array<App>
    constructor(items: Array<App>) {
        this.items = items
    }
}

export class App {
    id: string
    name: string

    constructor(id: string, name: string) {
        this.id = id
        this.name = name
    }
}

export class Route {
    name: string
    routeUrl: string
    wildcard: boolean

    constructor(name: string, routeUrl: string, wildcard: boolean) {
        this.name = name
        this.routeUrl = routeUrl
        this.wildcard = wildcard
    }
}

export class Metadata {
    appName: string
    base: string
    version: string
    appRoutes: Array<Route>
    rawLogs: string

    constructor(appName: string, base: string, version: string, appRoutes: Array<Route>, rawLogs: string) {
        this.appName = appName;
        this.base = base;
        this.version = version;
        this.appRoutes = appRoutes
        this.rawLogs = rawLogs
    }
}

export class FermyonClient {
    base: string
    token: string
    _httpclient: httpm.HttpClient

    constructor(base: string) {
        this.base = base
        this.token = getToken()
        core.info(`token is ${this.token}`)
        this._httpclient = new httpm.HttpClient("fermyon-preview-deployment", [], {
            headers: {
                Authorization: `Bearer ${this.token}`
            }
        })
    }

    async getAllApps(): Promise<App[]> {
        const resp = await this._httpclient.get(`${this.base}/api/apps`)
        if (resp.message.statusCode !== httpm.HttpCodes.OK) {
            throw `expexted code ${httpm.HttpCodes.OK}, got ${resp.message.statusCode}`
        }

        const appsResp: GetAppsResp = JSON.parse(await resp.readBody())
        return appsResp.items;
    }

    async getAppIdByName(name: string): Promise<string> {
        let apps = await this.getAllApps()
        const app = apps.find(item => item.name === name);
        if (!app) {
            throw `no app found with name ${name}`
        }

        return app.id;
    }

    async deleteAppById(id: string): Promise<void> {
        const resp = await this._httpclient.get(`${this.base}/api/apps`)
        if (resp.message.statusCode !== 201) {
            throw `expexted code ${201}, got ${resp.message.statusCode}`
        }
    }

    async deleteAppByName(name: string): Promise<void> {
        let appId = await this.getAppIdByName(name)
        this.deleteAppById(appId)
    }

    async deploy(appName: string): Promise<Metadata> {
        const result = await exec.getExecOutput("spin", ["deploy"])
        if (result.exitCode != 0) {
            throw `deploy failed with [status_code: ${result.exitCode}] [stdout: ${result.stdout}] [stderr: ${result.stderr}] `
        }

        let version = '';
        const m = result.stdout.match(`Uploading ${appName} version (.*)\.\.\.`)
        if (m && m.length > 1) {
            version = m[1]
        }

        let routeStart = false;
        const routeMatcher = `^\s+(.*): (https?://[^\s^\\(]+)(.*)`
        const lines = result.stdout.split("\n")
        let routes = new Array<Route>();
        let base = '';
        for (let i = 0; i < lines.length; i++) {
            if (!routeStart && lines[i].trim() != 'Available Routes:') {
                continue
            }

            if (!routeStart) {
                routeStart = true
                continue
            }

            const matches = lines[i].match(routeMatcher)
            if (matches && matches.length >= 2) {
                const route = new Route(matches[1], matches[2], matches[3].trim() === '(wildcard)')
                routes.push(route)
            }
        }

        return new Metadata(appName, base, version, routes, result.stdout)
    }
}

export class TokenInfo {
    token: string

    constructor(token: string) {
        this.token = token
    }
}

export const getToken = function (): string {
    let token: string = '';
    const data = fs.readFileSync("developer-docs-preview.json", "utf8");

    const tokenInfo: TokenInfo = JSON.parse(data);
    return tokenInfo.token;
}

export class SpinConfig {
    name: string

    constructor(name: string) {
        this.name = name
    }
}

export const getSpinConfig = function (): SpinConfig {
    let token: string = '';
    const data = fs.readFileSync("spin.toml", "utf8");

    const config: SpinConfig = toml.parse(data);
    return config
}