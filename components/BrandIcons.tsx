type IconProps = {
  className?: string;
  title?: string;
};

export function GmailIcon({ className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="#4285F4"
        d="M34.909 453.507h81.455V255.699L0 168.576v249.022c0 19.846 16.137 35.909 34.909 35.909z"
      />
      <path
        fill="#34A853"
        d="M395.636 453.507h81.455c19.846 0 34.909-16.137 34.909-34.909V168.576l-116.364 87.123z"
      />
      <path
        fill="#FBBC04"
        d="M395.636 93.259v162.44L512 168.576V110.87c0-53.382-60.945-83.782-103.691-51.782z"
      />
      <path
        fill="#EA4335"
        d="M116.364 255.699V93.259L256 197.946l139.636-104.687v162.44L256 360.386z"
      />
      <path
        fill="#C5221F"
        d="M0 110.87v57.706l116.364 87.123V93.259l-12.655-9.491C60.945 51.768 0 82.168 0 110.87z"
      />
    </svg>
  );
}

export function DriveIcon({ className, title }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 87.3 78"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="#0066DA"
        d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z"
        transform="translate(0 0)"
      />
      <path
        fill="#00AC47"
        d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9.06 9.06 0 000 53h27.5z"
      />
      <path
        fill="#EA4335"
        d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z"
      />
      <path
        fill="#00832D"
        d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"
      />
      <path
        fill="#2684FC"
        d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"
      />
      <path
        fill="#FFBA00"
        d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
      />
    </svg>
  );
}
