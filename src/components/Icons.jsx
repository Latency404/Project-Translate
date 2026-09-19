// Icons 1:1 aus Resources/Figma/Icons (Figma-Export), Strichfarbe auf currentColor
// umgestellt, damit sie über text-* eingefärbt werden können.

export function AutoDetectIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M8.66657 9.33331L6.66657 7.33331M10.0068 2.33331V1.33331M12.633 3.37375L13.3401 2.66665M12.633 8.66665L13.3401 9.37378M7.34011 3.37375L6.63303 2.66665M13.6734 5.99998H14.6734M4.08748 13.9124L10.2456 7.75425C10.5096 7.49025 10.6416 7.35818 10.6911 7.20598C10.7346 7.07211 10.7346 6.92785 10.6911 6.79398C10.6416 6.64175 10.5096 6.50975 10.2456 6.24573L9.75417 5.75423C9.49011 5.49021 9.35811 5.35821 9.20591 5.30875C9.07204 5.26525 8.92777 5.26525 8.79391 5.30875C8.64164 5.35821 8.50964 5.49021 8.24564 5.75423L2.08748 11.9124C1.82347 12.1764 1.69147 12.3084 1.64201 12.4606C1.5985 12.5945 1.5985 12.7388 1.64201 12.8726C1.69147 13.0248 1.82347 13.1569 2.08748 13.4209L2.57899 13.9124C2.843 14.1764 2.97501 14.3084 3.12723 14.3578C3.26112 14.4014 3.40535 14.4014 3.53925 14.3578C3.69147 14.3084 3.82347 14.1764 4.08748 13.9124Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function EditIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M12.0001 6.66671L9.33344 4.00004M1.66675 14.3334L3.92299 14.0827C4.19865 14.052 4.33648 14.0367 4.46531 13.995C4.57961 13.958 4.68838 13.9058 4.78867 13.8396C4.90171 13.765 4.99977 13.667 5.1959 13.4709L14.0001 4.66671C14.7365 3.93033 14.7365 2.73642 14.0001 2.00004C13.2637 1.26366 12.0698 1.26366 11.3334 2.00004L2.52923 10.8042C2.33311 11.0004 2.23505 11.0984 2.16051 11.2114C2.09437 11.3118 2.04209 11.4205 2.00509 11.5348C1.96339 11.6636 1.94807 11.8014 1.91744 12.0771L1.66675 14.3334Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FolderIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M8.66683 4.66667L7.92316 3.17928C7.7091 2.7512 7.6021 2.53715 7.44243 2.38077C7.30123 2.24249 7.13103 2.13731 6.94423 2.07287C6.73296 2 6.49364 2 6.01502 2H3.46683C2.7201 2 2.34672 2 2.06151 2.14533C1.81062 2.27315 1.60665 2.47713 1.47882 2.72801C1.3335 3.01323 1.3335 3.3866 1.3335 4.13333V4.66667M1.3335 4.66667H11.4668C12.587 4.66667 13.147 4.66667 13.5748 4.88465C13.9512 5.0764 14.2571 5.38236 14.4488 5.75869C14.6668 6.18651 14.6668 6.74653 14.6668 7.86667V10.8C14.6668 11.9201 14.6668 12.4801 14.4488 12.908C14.2571 13.2843 13.9512 13.5903 13.5748 13.782C13.147 14 12.587 14 11.4668 14H4.5335C3.41339 14 2.85334 14 2.42552 13.782C2.04919 13.5903 1.74323 13.2843 1.55148 12.908C1.3335 12.4801 1.3335 11.9201 1.3335 10.8V4.66667Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function GoToModsIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M10 2.00001H14V6.00001M14 2.00001L8 8M6.66667 2H5.2C4.07989 2 3.51984 2 3.09202 2.21799C2.71569 2.40973 2.40973 2.71569 2.21799 3.09202C2 3.51984 2 4.07989 2 5.2V10.8C2 11.9201 2 12.4801 2.21799 12.908C2.40973 13.2843 2.71569 13.5903 3.09202 13.782C3.51984 14 4.07989 14 5.2 14H10.8C11.9201 14 12.4801 14 12.908 13.782C13.2843 13.5903 13.5903 13.2843 13.782 12.908C14 12.4801 14 11.9201 14 10.8V9.33333" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function NoIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SaveIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M10 5.33333H5.73333C5.35997 5.33333 5.17328 5.33333 5.03067 5.26067C4.90523 5.19675 4.80325 5.09477 4.73933 4.96933C4.66667 4.82672 4.66667 4.64003 4.66667 4.26667V2M11.3333 14V9.73333C11.3333 9.35993 11.3333 9.17327 11.2607 9.03067C11.1967 8.9052 11.0948 8.80327 10.9693 8.73933C10.8267 8.66667 10.6401 8.66667 10.2667 8.66667H5.73333C5.35997 8.66667 5.17328 8.66667 5.03067 8.73933C4.90523 8.80327 4.80325 8.9052 4.73933 9.03067C4.66667 9.17327 4.66667 9.35993 4.66667 9.73333V14M14 6.21699V10.8C14 11.9201 14 12.4801 13.782 12.908C13.5903 13.2843 13.2843 13.5903 12.908 13.782C12.4801 14 11.9201 14 10.8 14H5.2C4.07989 14 3.51984 14 3.09202 13.782C2.71569 13.5903 2.40973 13.2843 2.21799 12.908C2 12.4801 2 11.9201 2 10.8V5.2C2 4.07989 2 3.51984 2.21799 3.09202C2.40973 2.71569 2.71569 2.40973 3.09202 2.21799C3.51984 2 4.07989 2 5.2 2H9.783C10.1091 2 10.2722 2 10.4257 2.03684C10.5617 2.0695 10.6917 2.12337 10.8111 2.19648C10.9456 2.27893 11.0609 2.39423 11.2915 2.62484L13.3751 4.70849C13.6057 4.9391 13.7211 5.0544 13.8035 5.18895C13.8766 5.30825 13.9305 5.43831 13.9631 5.57436C14 5.72781 14 5.89087 14 6.21699Z" stroke="currentColor" strokeWidth="1.33333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M14.875 14.875L10.6251 10.625M12.0417 7.08333C12.0417 9.82175 9.82175 12.0417 7.08333 12.0417C4.34492 12.0417 2.125 9.82175 2.125 7.08333C2.125 4.34492 4.34492 2.125 7.08333 2.125C9.82175 2.125 12.0417 4.34492 12.0417 7.08333Z" stroke="currentColor" strokeWidth="2.125" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function YesIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
    <path d="M13.3332 4L5.99984 11.3333L2.6665 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ResetIcon({ size = 16, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path d="M2 10C2 10 4.00498 7.26822 5.63384 5.63824C7.26269 4.00827 9.5136 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.89691 21 4.43511 18.2543 3.35177 14.5M2 10V4M2 10H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
