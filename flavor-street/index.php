<?php
/**
 * メインテンプレート（フォールバック）
 *
 * @package FlavorStreet
 */

get_header();
?>

<main class="fs-main">
	<section class="fs-page-hero fs-page-hero--compact">
		<div class="fs-page-hero__bg">
			<div class="fs-page-hero__overlay fs-page-hero__overlay--light"></div>
		</div>
		<div class="fs-page-hero__content fs-container">
			<h1 class="fs-page-hero__title">
				<?php
				if ( is_home() ) {
					echo 'ブログ';
				} elseif ( is_search() ) {
					printf( '「%s」の検索結果', esc_html( get_search_query() ) );
				} elseif ( is_archive() ) {
					the_archive_title();
				} else {
					the_title();
				}
				?>
			</h1>
		</div>
	</section>

	<section class="fs-archive fs-section">
		<div class="fs-container">
			<?php if ( have_posts() ) : ?>
				<div class="fs-archive__grid">
					<?php while ( have_posts() ) : the_post(); ?>
						<article class="fs-archive__card">
							<a href="<?php the_permalink(); ?>" class="fs-archive__card-link">
								<div class="fs-archive__card-image">
									<?php if ( has_post_thumbnail() ) : ?>
										<?php the_post_thumbnail( 'fs-card' ); ?>
									<?php else : ?>
										<img src="<?php echo fs_placeholder_img( 600, 400, 'No Image' ); ?>" alt="">
									<?php endif; ?>
								</div>
								<div class="fs-archive__card-body">
									<time class="fs-archive__card-date" datetime="<?php echo get_the_date( 'Y-m-d' ); ?>">
										<?php echo get_the_date( 'Y.m.d' ); ?>
									</time>
									<h2 class="fs-archive__card-title"><?php the_title(); ?></h2>
									<p class="fs-archive__card-excerpt"><?php echo wp_trim_words( get_the_excerpt(), 60, '...' ); ?></p>
								</div>
							</a>
						</article>
					<?php endwhile; ?>
				</div>

				<nav class="fs-pagination">
					<?php
					the_posts_pagination( array(
						'mid_size'  => 2,
						'prev_text' => '&laquo; 前へ',
						'next_text' => '次へ &raquo;',
					) );
					?>
				</nav>
			<?php else : ?>
				<div class="fs-archive__empty">
					<p>記事が見つかりませんでした。</p>
				</div>
			<?php endif; ?>
		</div>
	</section>
</main>

<?php get_footer(); ?>
