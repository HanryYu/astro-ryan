import type { APIRoute } from 'astro';
import cheerio from 'cheerio';

const COLOR_MAP = {
  0: "#ebedf0",
  1: "#9be9a8",
  2: "#40c463",
  3: "#30a14e",
  4: "#216e39"
}  as const;

type ColorLevel = keyof typeof COLOR_MAP;

async function fetchYears(username: string): Promise<{ href: string; text: string }[]> {
  const data = await fetch(`https://github.com/${username}?tab=contributions`, {
    headers: {
      "x-requested-with": "XMLHttpRequest"
    }
  });
  const body = await data.text();
  const $ = cheerio.load(body);
  return $(".js-year-link")
    .get()
    .map((a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const githubUrl = new URL(`https://github.com${href}`);
      githubUrl.searchParams.set("tab", "contributions");
      const formattedHref = `${githubUrl.pathname}${githubUrl.search}`;
      return {
        href: formattedHref,
        text: $a.text().trim()
      };
    });
}

async function fetchDataForYear(url: string, year: string, format: string) {
  const data = await fetch(`https://github.com${url}`, {
    headers: {
      "x-requested-with": "XMLHttpRequest"
    }
  });
  const $ = cheerio.load(await data.text());
  const $days = $("table.ContributionCalendar-grid td.ContributionCalendar-day");
  const contribText = $(".js-yearly-contributions h2")
    .text()
    .trim()
    .match(/^([0-9,]+)\s/);
  let contribCount = 0;
  if (contribText && contribText[1]) {
    contribCount = parseInt(contribText[1].replace(/,/g, ""), 10);
  }

  const parseDay = (day: cheerio.Element, index: number) => {
    const $day = $(day);
    const date = $day.attr("data-date")?.split("-").map((d) => parseInt(d, 10)) || [];
    const dataLevel = $day.attr("data-level");
    const level = (dataLevel && ["0", "1", "2", "3", "4"].includes(dataLevel) 
      ? dataLevel as unknown as ColorLevel 
      : "0") as ColorLevel;
    const color = COLOR_MAP[level];
    const value = {
      date: $day.attr("data-date"),
      count: index === 0 ? contribCount : 0,
      color,
      intensity: level
    };
    return { date, value };
  };

  const contributions = format !== "nested"
    ? $days.get().map((day, index) => parseDay(day, index).value)
    : $days.get().reduce((o: any, day, index) => {
        const { date, value } = parseDay(day, index);
        const [y, m, d] = date;
        if (y !== undefined && m !== undefined && d !== undefined) {
          if (!o[y]) o[y] = {};
          if (!o[y][m]) o[y][m] = {};
          o[y][m][d] = value;
        }
        return o;
      }, {});

  return {
    year,
    total: contribCount,
    range: {
      start: $($days.get(0)).attr("data-date"),
      end: $($days.get($days.length - 1)).attr("data-date")
    },
    contributions
  };
}

async function fetchDataForAllYears(username: string, format: string) {
  const years = await fetchYears(username);
  const yearsData = await Promise.all(
    years.map((year) => fetchDataForYear(year.href, year.text, format))
  );

  const formatYears = () => {
    if (format === "nested") {
      return Object.fromEntries(yearsData.map(year => [year.year, year]));
    }
    return yearsData.map(({ contributions, ...rest }) => rest);
  };

  const formatContributions = () => {
    if (format === "nested") {
      return yearsData.reduce((acc, curr) => ({ ...acc, ...curr.contributions }), {});
    }
    return yearsData
      .flatMap(year => year.contributions)
      .sort((a: any, b: any) => {
        if (a.date < b.date) return 1;
        else if (a.date > b.date) return -1;
        return 0;
      });
  };

  return {
    years: formatYears(),
    contributions: formatContributions()
  };
}

export const GET: APIRoute = async ({ params, request }) => {
  const username = params.username;
  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'default';

  if (!username) {
    return new Response(JSON.stringify({ error: 'Username is required' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  try {
    const data = await fetchDataForAllYears(username, format);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate'
      }
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
};

export const prerender = false;